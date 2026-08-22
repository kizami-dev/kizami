# v0.1 データモデル設計

- 前提: [要件定義書](../requirements.md) Draft 4
- 決定(2026-08-21): 打刻は**追記専用(append-only)**、集計は**常時再計算+締め時スナップショット確定**

## 設計原則

1. **打刻イベントは不可変**。UPDATE/DELETE は発行しない。訂正は「前のイベントを無効化する新イベント」で表現し、監査証跡が構造そのものになる
2. **現在の状態は導出**。有効な打刻列 = 「他のイベントに無効化されていないイベント」のビュー。集計エンジンには有効打刻列だけを渡す
3. 全テーブルに `tenant_id`(マルチテナント要件)。v0.1 の運用は単一テナントだがモデルは最初から分離
4. ID は UUIDv7(時系列ソート可能・全ダイアレクトで文字列として扱える)
5. 時刻は UTC のエポック分(integer)で保存。**分単位が原則の系で秒を持たない**ことで丸め問題を型レベルで排除。表示層でテナントTZ(Asia/Tokyo)へ変換
6. **制度・設定は effective-dated**。計算に影響する設定(労働時間制・日界・法定休日・休憩ルール等)は上書きせず「適用開始日付きの版」を追加する。過去日の計算は常に「その日に有効だった版」で行われ、制度変更が過去に遡って影響しない。締め済み期間はさらにスナップショット(§closings)で二重に保護される

## テーブル

### punch_events(追記専用)

| カラム | 型 | 備考 |
| --- | --- | --- |
| id | uuid v7 PK | |
| tenant_id | uuid | |
| user_id | uuid | 打刻の対象者 |
| kind | text | `clock_in` / `clock_out` / `break_start` / `break_end` |
| occurred_at | int (epoch分, UTC) | 労働時間計算に使う時刻 |
| recorded_at | int (epoch分, UTC) | サーバーが受理した時刻 |
| source | text | `web` / `pwa` / `slack` / `api` / `mcp` |
| actor_id | uuid | 誰が記録したか(本人打刻なら user_id と同じ、承認反映なら承認者) |
| supersedes_id | uuid null | 無効化する対象イベント。訂正・取消のときのみ |
| correction_request_id | uuid null | 承認による反映の場合、その申請への参照 |
| note | text null | |
| meta_ip / meta_ua | text null | 証跡メタデータ |
| meta_gps_lat / meta_gps_lng | real null | テナント設定で GPS 有効時のみ。保持期間経過後は null 化(行は消さない) |

- 「取消」は `kind` を引き継がず `supersedes_id` のみ持つ専用 kind `void` で表現
- **有効イベント** = 他のイベントの `supersedes_id` に参照されていないもの(同一イベントを二重に無効化することは UNIQUE 制約で禁止)
- 修正申請の承認以外で他人のイベントを直接無効化できるのは、権限 `attendance.correction.direct`(危険権限)のみ

### correction_requests(修正申請)

| カラム | 型 | 備考 |
| --- | --- | --- |
| id / tenant_id / user_id | | user_id は対象者 |
| status | text | `pending` / `approved` / `rejected` / `withdrawn` |
| target_event_id | uuid null | 訂正対象(新規追加申請なら null) |
| proposed_kind / proposed_occurred_at | | 申請内容 |
| reason | text | 申請理由(必須) |
| decided_by / decided_at / decision_note | | 承認・却下の記録 |

- 承認時にトランザクションで punch_events に反映イベントを追記し、`correction_request_id` で紐付ける
- 状態遷移は `pending → approved / rejected / withdrawn` のみ(approved 後の変更は不可。取り消したい場合は新たな申請)

### closing_events(締め)と closing_snapshots

- **closing_events(追記専用)**: (id, tenant_id, period "YYYY-MM", event `close`/`reopen`, actor_id, note, occurred_at)。
  現在の締め状態はこのイベント列から導出する。**状態を持つ `closings` テーブルは作らない**
  (2026-08-22 実装時に決定。当初案では status を持つテーブルを併置していたが、
  イベントから完全に導出できる以上、二重管理は不整合の余地を作るだけだった)。
  「誰がいつ解除したか」要件(§6)は履歴そのもので満たされる
- **closing_snapshots**: 締め確定時の (closing_event_id, user_id, category, minutes)。
  category には区分別時間数5種に加えフレックス収支3種(flexFrame/flexActual/flexDiff)も
  同じ形式で入れる(別カラムにせず統一)。締め済み期間の表示・エクスポートは常に
  スナップショットから読む。open 期間はエンジンでオンデマンド計算

### 組織・認証・権限

- **tenants**: 名称などの不変属性のみ。計算に影響する設定は持たない
- **tenant_setting_versions**(追記専用): 計算に影響するテナント設定の版。`effective_from`(ローカル日付)+型付きカラム(day_boundary_minutes, legal_holiday_rule, break_rule, gps_enabled, gps_retention_days null=勤怠と同一)。ある日の計算にはその日時点で最新の版を適用。編集UIは「新しい版を追加」しかできない
- **work_policies / work_policy_versions**: 労働時間制の定義(v0.1はフレックス設定のみ: settlement_period, core=null, standard_day_minutes — 有給日の枠算入に使う標準労働時間。エンジンの `FlexSettings` に対応)。テナント設定と同様に版管理
- **user_policy_assignments**: user × work_policy × `effective_from`。従業員がいつからどの制度に属すかも effective-dated(将来、固定時間制⇔フレックスの移動が発生しても過去分に影響しない)
- **users / auth_credentials / sessions**: 自前認証(email+パスワード)。パスワードハッシュは **WebCrypto PBKDF2-SHA256(600,000回)** — argon2id から変更(2026-08-21)。argon2 はネイティブ実装で workerd 非対応のため、Workers 動作保証(要件§8)と両立するランタイム非依存の方式を採用。OIDC 用の外部 ID テーブルは v1.0 で追加
- **departments**(parent_id による木)+ **memberships**(user×department×役職)— v0.1 ではフラット1部署で運用可
- **permission_presets**: 名前+説明+`grants`(業務タスク権限キー×スコープの配列、JSON)。同梱プリセットは `system` フラグで編集不可
- **preset_assignments**: user×preset(複数可・合算)。実効権限はメモリ上で展開しキャッシュ
- 権限カタログの具体項目は [permission-catalog.md](./permission-catalog.md) 参照

### audit_logs(追記専用)

打刻以外の変更(テナント設定・プリセット編集・割当・締め操作・認証イベント)を記録: actor_id / action / target / before・after のダイジェスト / occurred_at。打刻の監査は punch_events 自体が担うため二重記録しない。

## 集計エンジンの入出力(packages/engine)

```
input:  { punches: ValidPunch[], settingsTimeline: Array<{ from: PlainDate, settings: CalcSettings }>,
          period: { year, month }, paidLeave: Array<{ date: PlainDate, minutes: number }> }
output: { days: DailyBreakdown[], totals: CategorizedMinutes,
          flexBalance: { frameMinutes, actualMinutes, diffMinutes } }
```

- ValidPunch = 有効イベントのみに絞った `{ kind, occurredAt }`。DB の形をエンジンに持ち込まない
- `paidLeave` は「その日に何分ぶん有給を使ったか」で表す(2026-08-22 変更)。全休は所定労働時間、半休はその半分、時間単位はその分数。日単位・時間単位を別概念にせず分に統一することで、残高・時効・枠算入のロジックが一本化される
- settingsTimeline により期間途中の制度・設定変更を日単位で正しく適用(原則6)。「期間中の設定切替」はゴールデンケースの必須ケース群に含める
- 不正打刻列(clock_in 連打、対応しない break_end 等)の扱いは**エラーではなく警告付き解釈**とし、解釈ルール自体をゴールデンケースで固定する(v0.1 実装時の設計ポイント)

## ゴールデンケース YAML スキーマ(確定)

```yaml
name: ケース名
law_reference: 根拠条文
settings:
  day_boundary: "05:00"        # テナント設定サブセット
  legal_holiday: { weekday: sunday }
  flex: { settlement: monthly, core: null }
  break_rule: { mode: punch }   # punch | auto | both
period: 2026-04
paid_leave_days: ["2026-04-10"]        # 全休(後方互換)。時間単位は paid_leave: [{date, minutes}]
punches:                        # ローカル時刻(Asia/Tokyo)で記述、ローダーがUTC分へ変換
  - { kind: clock_in,  at: "2026-04-01T09:30" }
  - { kind: clock_out, at: "2026-04-01T19:00" }
expected:
  totals: { statutory: 0, overtime: 0, overtime60h: 0, lateNight: 0, statutoryHoliday: 0 }
  flex_balance: { frame: 10285, actual: 0, diff: -10285 }  # 分
  warnings: []                  # 不正列解釈の警告もここで固定
```

## 不正打刻列の解釈ルール(2026-08-21 決定)

方針は**保守的解釈**: 不完全なデータから労働時間を捏造しない。

1. **未完の勤務区間**(clock_in のまま終端)は集計から除外し `missing_clock_out` 警告。当日進行中の表示のみ「勤務中」
2. **文脈上ありえない打刻**(勤務中の再 clock_in、勤務外の clock_out / break、休憩中の再 break_start、対応しない break_end)は無効化して警告。イベント自体は不可変で残るため、修正申請で正しい列に直せる
3. 例外として**休憩中の clock_out** は「休憩を閉じて退勤」と解釈する(労働時間が減る方向の補完のみ許す)+警告

警告の種類は `packages/engine/src/types.ts` の `WarningKind` が正。解釈ルール自体をゴールデンケースで固定する。

実装時の追加決定(2026-08-21):

- 未完の勤務区間を破棄するときは、その中で完結していた休憩も含めて丸ごと破棄する(clock_in からの一続きを1単位として扱う)
- `days` は期間月の全暦日を出力する(打刻ゼロの日にも有給・法定休日フラグが意味を持つため)
- 日界・tzOffset 自体が設定版に属するため「どの版か」と「どの勤怠日か」が相互依存する。実装は「最新版で仮日付→その日の実際の版で再解決」の2パス方式(tzOffset が版をまたいで一定である通常運用を前提)

## 未決(v0.1 実装中に確定)

- 実効権限キャッシュの無効化タイミング(割当変更時の伝播)
