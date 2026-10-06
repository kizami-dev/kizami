/**
 * アトミックな書き込み計画(atomic plan)— 3ダイアレクト共通の「複数文を1単位で書く」手段。
 *
 * ## なぜ db.transaction() ではないのか
 *
 * Cloudflare D1 は `BEGIN` / `SAVEPOINT` を拒否し、複数文を原子的に実行する手段は
 * `db.batch([...])` だけ(src/d1.ts 冒頭)。batch は「文を全部先に渡して、まとめて実行する」
 * 形なので、従来のコールバック型トランザクションのように **途中の結果を JS で見て分岐する**
 * ことができない。KIZAMI の書き込みの大半は「楽観ロックで行を取る(claim)→ 取れたときだけ
 * 依存する書き込みをする」形で、この「取れたときだけ」を batch の前に決められない。
 *
 * そこで書き込みを **計画(AtomicPlan)** として先に組み立て、`runAtomic()` が
 * ダイアレクトに合った方法で1単位として実行する:
 *
 * - SQLite(libSQL)/ D1: `db.batch(statements)`。両方とも batch を1トランザクションで流す
 * - PostgreSQL(node-postgres): batch が無いので `db.transaction()` の中で順に実行する
 *
 * 結果は **コミット後に** 文ごとに取り出す(`result.get(ref)`)。計画の中では前の文の結果を
 * 読めない(read-your-writes 不可)— 読み取りは計画の外(前)で済ませること。
 *
 * ## ガード(claim が取れなかったら何も書かない)
 *
 * 判断点(2026-10-07、D1 の原子的書き込みの設計。詳細と比較は docs/design/d1-atomic-writes.md):
 * 「この実行の claim が成功したか」を依存文ごとに SQL の条件(`INSERT ... SELECT ... WHERE
 * EXISTS(...)`)で表す案(自己条件付き文)と、**claim の直後に「直前の文が1行も変えて
 * いなければ計画全体を失敗させる」文(ガード)を挟む案**を比べ、後者を採った。
 *
 * - SQLite / D1: ガードは `SELECT json_extract('{}', CASE WHEN changes() = 0 THEN
 *   'kizami-atomic-guard:<label>' ELSE '$' END)`。`changes()` は同じ接続で直前に完了した
 *   INSERT/UPDATE/DELETE の変更行数で、batch は1接続で順に流れるので「直前の文」= claim を
 *   指す(workerd の D1 と libSQL の両方で確認済み — test/atomic.test.ts)。0 行なら不正な
 *   JSON パスでエラーになり、batch ごとロールバックされる。`runAtomic` はこのエラーだけを
 *   識別して `{ ok: false, failedGuard }` に変える
 * - PostgreSQL: 本物のトランザクションの中で直前の文の結果行数を JS で見て、0 なら例外で
 *   ロールバックする(従来の `if (!row) throw` と同じ挙動)
 *
 * 採った理由:
 * - 失敗が閉じる側に倒れる(fail-closed)。自己条件付き文は依存文の1つに条件を書き忘れると
 *   黙って書き込みが残る。ガードは計画全体を巻き戻すので、依存文は今までどおりの素の
 *   insert/update のままでよい(残りの移行が機械的になる)
 * - claim 行に「この実行のトークン」列を足すスキーマ変更が要らない(自己条件付き文を
 *   PostgreSQL の READ COMMITTED でも正しくするには、claim 側の時刻値ではなく実行ごとに
 *   一意なトークンを claim 行へ書く必要がある — 時刻は同時リクエストで衝突する)
 * - PostgreSQL の挙動が従来と同一(本物のトランザクション + JS 判定)
 *
 * 代償: SQLite 側は `changes()` の意味と、エラー文言(`bad JSON path`)に依存する。
 * どちらも test/atomic.test.ts が3レグで固定している。D1 が batch の文の間に別の文を挟む
 * 実装に変わると壊れるため、壊れたらこのテストが落ちる。
 *
 * ## 直列化キー(PostgreSQL の「読んでから書く」競合)
 *
 * 「行が無いこと/最新の状態が X であること」を条件に追記する claim(締めの closing_events 等)は、
 * PostgreSQL の READ COMMITTED では2つのトランザクションが互いの未コミット行を見ずに
 * 両方とも成功しうる。`plan.serialize(key)` は PostgreSQL でだけ
 * `pg_advisory_xact_lock` を取り、同じキーの計画をトランザクション単位で直列化する。
 * SQLite / D1 は書き込みがもともと直列(1ライター)なので何もしない。
 */

import { entityKind, getTableColumns, is, sql, SQL, type Table } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Database, Transaction } from "./types.js";

/**
 * 計画の文を組み立てるときに渡される実行先。
 *
 * SQLite/D1 では `db` そのもの、PostgreSQL ではトランザクション(`tx`)が渡る。drizzle の
 * クエリビルダは作った時点のセッションに紐づくため、`db` で作ったビルダを PostgreSQL の
 * トランザクション内で実行することはできない — そのため計画の文は「ビルダ」ではなく
 * 「実行先を受け取ってビルダを返す関数」で渡す。
 */
export type AtomicExecutor = Database | Transaction;

/**
 * D1 の1文あたりのバインド変数の上限。
 * (https://developers.cloudflare.com/d1/platform/limits/ 「Maximum number of bound parameters per query」)
 */
export const D1_MAX_BOUND_PARAMETERS = 100;

/** 計画に積んだ文への参照。コミット後に `result.get(ref)` で結果を取り出す。 */
export interface AtomicStepRef<T> {
  readonly index: number;
  /** 型だけの印(実行時には存在しない) */
  readonly __result?: T;
}

/** 計画の1手順(文・ガード・直列化キー)。`runAtomic` が順に解釈する。 */
export type AtomicStep =
  | { kind: "query"; factory: (q: AtomicExecutor) => unknown }
  | { kind: "guard"; label: string }
  | { kind: "serialize"; key: string };

/** ガードのラベル。SQL へ文字列リテラルとして埋め込むため、安全な文字だけを許す。 */
const GUARD_LABEL_PATTERN = /^[a-z0-9_.-]{1,64}$/;
const GUARD_MARKER_PREFIX = "kizami-atomic-guard:";
const GUARD_MARKER_PATTERN = /kizami-atomic-guard:([a-z0-9_.-]{1,64})/;
/** SQLite の不正 JSON パスのエラー文言(3.45 以降は "bad JSON path"、それ以前は "JSON path error")。 */
const JSON_PATH_ERROR_PATTERN = /bad JSON path|JSON path error/;
/** ガードの直前に置ける文(変更行数を持つ文)の drizzle entityKind。 */
const WRITE_ENTITY_KIND = /^(SQLite|Pg)(Insert|Update|Delete)$/;

/**
 * アトミックに実行する書き込みの計画。
 *
 * ```ts
 * const plan = new AtomicPlan();
 * const claim = plan.add((q) => q.update(invitations).set({ acceptedAt: now }).where(...).returning());
 * plan.guard("invitation.claim"); // claim が 0 行なら、以降を含め何も書かない
 * plan.add((q) => q.insert(authCredentials).values({ ... }));
 * const result = await runAtomic(db, plan);
 * if (!result.ok) return null;
 * const [row] = result.get(claim);
 * ```
 */
export class AtomicPlan {
  readonly #steps: AtomicStep[] = [];
  #queryCount = 0;

  /**
   * 文を1つ積む。`factory` は実行先(SQLite/D1 は db、PostgreSQL は tx)を受け取り、
   * drizzle のクエリビルダを返すこと(await しない)。結果を後で見たい文は `.returning()` を
   * 付ける — 戻り値の形(行の配列)が3ダイアレクトで一致するのは returning 付きの文だけ。
   */
  add<T>(factory: (q: AtomicExecutor) => T): AtomicStepRef<Awaited<T>> {
    this.#steps.push({ kind: "query", factory });
    const ref: AtomicStepRef<Awaited<T>> = { index: this.#queryCount };
    this.#queryCount += 1;
    return ref;
  }

  /**
   * 直前に積んだ書き込み文(insert/update/delete)が1行も変えていなければ、計画全体を
   * 失敗させる(何も書かない)。`runAtomic` は `{ ok: false, failedGuard: label }` を返す。
   */
  guard(label: string): this {
    if (!GUARD_LABEL_PATTERN.test(label)) {
      throw new Error(`AtomicPlan.guard: label must match ${GUARD_LABEL_PATTERN.source}, got: ${label}`);
    }
    const prev = this.#steps[this.#steps.length - 1];
    if (prev?.kind !== "query") {
      throw new Error("AtomicPlan.guard: a guard must directly follow a write statement");
    }
    this.#steps.push({ kind: "guard", label });
    return this;
  }

  /**
   * 同じ `key` の計画を直列化する(PostgreSQL でだけ `pg_advisory_xact_lock` を取る)。
   * 「最新の状態が X なら追記する」型の claim の前に置く。SQLite/D1 は no-op。
   */
  serialize(key: string): this {
    this.#steps.push({ kind: "serialize", key });
    return this;
  }

  /** @internal runAtomic 用 */
  get steps(): readonly AtomicStep[] {
    return this.#steps;
  }

  /** 積んだ文(ガード・直列化を除く)の数。 */
  get size(): number {
    return this.#queryCount;
  }
}

/** `runAtomic` の結果。 */
export type AtomicResult =
  | {
      ok: true;
      /** コミット済みの文の結果を取り出す。 */
      get<T>(ref: AtomicStepRef<T>): T;
    }
  | {
      ok: false;
      /** 失敗したガードのラベル。何も書かれていない(ロールバック済み) */
      failedGuard: string;
    };

/** PostgreSQL 経路でガード失敗を運ぶ内部例外(トランザクションをロールバックさせるため)。 */
class AtomicGuardAbort extends Error {
  constructor(readonly label: string) {
    super(`${GUARD_MARKER_PREFIX}${label}`);
  }
}

/**
 * 計画を1単位で実行する。ガードが失敗したら `{ ok: false }`(何も書かれていない)。
 * それ以外のエラー(UNIQUE 違反等)はそのまま投げる — 呼び出し側は従来どおり
 * `isUniqueConstraintError`(src/errors.ts)で判定できる。
 *
 * @param db 最上位の DB ハンドル(トランザクションの中からは呼ばないこと)
 */
export async function runAtomic(db: Database, plan: AtomicPlan): Promise<AtomicResult> {
  if (plan.size === 0) return okResult([]);
  return supportsBatch(db) ? runAsBatch(db, plan) : runAsTransaction(db, plan);
}

/** libSQL / D1 の drizzle は batch を持ち、node-postgres は持たない。 */
function supportsBatch(db: Database): boolean {
  return typeof (db as { batch?: unknown }).batch === "function";
}

function okResult(results: unknown[]): AtomicResult {
  return {
    ok: true,
    get<T>(ref: AtomicStepRef<T>): T {
      if (ref.index < 0 || ref.index >= results.length) {
        throw new Error(`AtomicResult.get: no statement at index ${ref.index}`);
      }
      return results[ref.index] as T;
    },
  };
}

function assertWriteStatement(builder: unknown): void {
  const kind = (builder as { constructor?: Record<symbol, unknown> } | null)?.constructor?.[entityKind];
  if (typeof kind !== "string" || !WRITE_ENTITY_KIND.test(kind)) {
    throw new Error(`AtomicPlan.guard: a guard must follow an insert/update/delete (got ${String(kind)})`);
  }
}

/** SQLite / D1 のガード文。ラベルは GUARD_LABEL_PATTERN で検査済みなのでリテラルで埋め込める。 */
function guardStatement(label: string): SQL {
  // パラメータを使わないのは、drizzle 0.45 の D1 batch がパラメータ付きの生 SQL(db.run(sql`...${x}`))を
  // 扱えないため(SQLiteRaw に stmt が無く "reading 'bind'" で落ちる)
  return sql.raw(`SELECT json_extract('{}', CASE WHEN changes() = 0 THEN '${GUARD_MARKER_PREFIX}${label}' ELSE '$' END) AS kizami_atomic_guard`);
}

async function runAsBatch(db: Database, plan: AtomicPlan): Promise<AtomicResult> {
  const statements: unknown[] = [];
  /** query ステップ i の結果が statements の何番目か */
  const resultIndexes: number[] = [];
  let prevBuilder: unknown;
  for (const step of plan.steps) {
    if (step.kind === "query") {
      prevBuilder = step.factory(db);
      resultIndexes.push(statements.length);
      statements.push(prevBuilder);
    } else if (step.kind === "guard") {
      assertWriteStatement(prevBuilder);
      statements.push(db.run(guardStatement(step.label)));
    }
    // serialize: SQLite / D1 は書き込みが直列なので何もしない(ファイル冒頭)
  }

  let raw: unknown[];
  try {
    raw = await (db.batch as (items: unknown[]) => Promise<unknown[]>)(statements);
  } catch (err) {
    const label = guardLabelFromError(err);
    if (label !== null) return { ok: false, failedGuard: label };
    throw err;
  }
  return okResult(resultIndexes.map((i) => raw[i]));
}

async function runAsTransaction(db: Database, plan: AtomicPlan): Promise<AtomicResult> {
  try {
    const results = await db.transaction(async (tx) => {
      const out: unknown[] = [];
      let prevBuilder: unknown;
      let prevResult: unknown;
      for (const step of plan.steps) {
        if (step.kind === "query") {
          prevBuilder = step.factory(tx);
          prevResult = await (prevBuilder as PromiseLike<unknown>);
          out.push(prevResult);
        } else if (step.kind === "guard") {
          assertWriteStatement(prevBuilder);
          if (affectedRows(prevResult) === 0) throw new AtomicGuardAbort(step.label);
        } else {
          // hashtextextended は text → bigint。キーの衝突は「無関係な計画同士が待ち合う」だけで、
          // 正しさには影響しない
          await (tx as unknown as { execute(q: SQL): Promise<unknown> }).execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${step.key}, 0))`,
          );
        }
      }
      return out;
    });
    return okResult(results);
  } catch (err) {
    if (err instanceof AtomicGuardAbort) return { ok: false, failedGuard: err.label };
    throw err;
  }
}

/** PostgreSQL の文の結果から変更行数を取る(returning 付きは行の配列、無しは QueryResult)。 */
function affectedRows(result: unknown): number {
  if (Array.isArray(result)) return result.length;
  const rowCount = (result as { rowCount?: unknown } | null)?.rowCount;
  if (typeof rowCount === "number") return rowCount;
  throw new Error("AtomicPlan.guard: cannot determine the affected row count of the previous statement");
}

/** ガード文のエラーなら、そのラベルを返す(cause を数段辿る。src/errors.ts と同じ流儀)。 */
function guardLabelFromError(err: unknown): string | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    const message = current.message;
    if (JSON_PATH_ERROR_PATTERN.test(message)) {
      const match = GUARD_MARKER_PATTERN.exec(message);
      if (match?.[1] !== undefined) return match[1];
    }
    current = current.cause;
  }
  return null;
}

/**
 * 複数行の insert を、D1 のバインド変数上限(1文 100 個)に収まる塊に割る。
 * 1行あたりの変数の数は「テーブルの全列」で見積もる(drizzle は values に無い列も
 * 既定値をパラメータで埋めることがあるため、最悪値で割る)。
 */
export function chunkRowsForInsert<T>(table: Table, rows: readonly T[], maxParams: number = D1_MAX_BOUND_PARAMETERS): T[][] {
  const perRow = Object.keys(getTableColumns(table)).length;
  const size = Math.max(1, Math.floor(maxParams / Math.max(1, perRow)));
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
  return chunks;
}

/**
 * `INSERT INTO t (全列) SELECT <値...> WHERE <condition>` を作る(condition が偽なら 0 行)。
 *
 * 「最新の状態が X のときだけ追記する」claim を1文で書くためのもの。直後に `plan.guard()` を
 * 置けば「追記できなかった = 競合」として計画全体を失敗させられる。値の埋め方(既定値・
 * defaultFn・null)は drizzle の `insert().values()` と同じ規則に揃えてある。
 */
export function insertSelectWhere<TTable extends SQLiteTable>(
  q: AtomicExecutor,
  table: TTable,
  row: TTable["$inferInsert"],
  condition: SQL,
) {
  const values: SQL[] = [];
  for (const [key, column] of Object.entries(getTableColumns(table))) {
    // shouldDisableInsert は drizzle の内部 API(生成列など insert しない列)。型には出ていない
    if ((column as unknown as { shouldDisableInsert(): boolean }).shouldDisableInsert()) continue;
    const value = (row as Record<string, unknown>)[key];
    if (value !== undefined) {
      values.push(sql`${sql.param(value, column)}`);
    } else if (column.default !== null && column.default !== undefined) {
      values.push(is(column.default, SQL) ? column.default : sql`${sql.param(column.default, column)}`);
    } else if (column.defaultFn !== undefined) {
      const generated: unknown = column.defaultFn();
      values.push(is(generated, SQL) ? generated : sql`${sql.param(generated, column)}`);
    } else {
      values.push(sql`null`);
    }
  }
  return q.insert(table).select(sql`select ${sql.join(values, sql`, `)} where ${condition}`);
}
