/**
 * このファイルは生成物です。手で編集しないでください。
 *
 * 生成元: packages/help-content/content/*.{ja,en,ko,zh}.md
 * 生成コマンド: pnpm --filter @kizami/help-content build
 *   (scripts/generate.mjs — content/*.md の frontmatter + 本文を読み取って書き出す)
 *
 * content/*.md を変更したら必ず再生成してコミットすること。生成物と content の不一致は
 * `pnpm --filter @kizami/help-content test` の drift チェックで検出される。
 */

/** ヘルプを見せる対象読者。 */
export type HelpAudience = "employee" | "admin";

/** 説明の出所。law=法令(変更不可・要根拠)、product=KIZAMIの仕様、company=導入企業の規定(DB管理・ここには含まれない)。 */
export type HelpOrigin = "law" | "product" | "company";

/** ヘルプ本文のロケール。apps/web/src/lib/i18n の `Locale` と同じ値。 */
export type HelpLocale = "ja" | "en" | "ko" | "zh";

/** 単一の正となるロケール。訳文が無いキーはこのロケールへフォールバックする。 */
export const HELP_SOURCE_LOCALE = "ja" as const;

/** 対応ロケールの一覧(表示順)。 */
export const HELP_LOCALES: readonly HelpLocale[] = ["ja","en","ko","zh"];

/** 参照キー(ドット区切り)の文字列リテラルunion。存在しないキーの参照はコンパイルエラーになる。 */
export type HelpKey = "agreement36.limits" | "attendance.auto-break" | "attendance.day-boundary" | "attendance.fixed-overtime" | "attendance.flex-frame" | "attendance.late-night" | "attendance.legal-holiday" | "attendance.minute-unit" | "attendance.warnings" | "attendance.work-system" | "closing.amend" | "closing.execute" | "closing.unlock" | "correction.flow" | "law.versioning" | "leave.grant" | "leave.hourly" | "leave.mandatory-five-days" | "overtime.60h" | "permission.presets" | "privacy.internal-terms-template" | "privacy.notice-template" | "privacy.retention-after-leaving" | "tenant.special-provision";

/** 1件のヘルプエントリ(packages/help-content/README.md のfrontmatter仕様に対応)。 */
export interface HelpEntry {
  key: HelpKey;
  audience: HelpAudience[];
  origin: HelpOrigin;
  /** origin: "law" のときのみ存在する根拠条文。 */
  basis?: string;
  /** ツールチップ・インラインヒントに出す短い説明。 */
  summary: string;
  /** VitePress にそのまま掲載する本文(Markdown、frontmatterを除く)。 */
  body: string;
  /** 導入企業向けの社内規定・記入例のプレースホルダ。 */
  companyExample?: string;
}

/** キー→ヘルプエントリの辞書(日本語)。日本語は常に全キーが揃っている。 */
export const HELP: Record<HelpKey, HelpEntry> = {
  "agreement36.limits": {
    key: "agreement36.limits",
    audience: ["employee","admin"],
    origin: "law",
    basis: "労働基準法36条4項・5項・6項(2019年4月1日施行、中小企業は2020年4月1日施行)",
    summary: "36協定で延長できる時間外労働は原則月45時間・年360時間までです。臨時的な特別の事情がある場合に限り、労使協定で結ぶ特別条項によって年720時間などの上限まで延長できますが、上限には回数や複数月平均の制限もあります。",
    body: "# 36協定の上限規制\n\n時間外労働・休日労働をさせるには、あらかじめ36協定(労使協定)の締結・届出が必要です。\nその延長時間には、罰則付きの上限があります(労働基準法36条4項〜6項)。\n\n## 原則(限度時間)\n\n| 区分 | 上限 |\n| --- | --- |\n| 月 | 45時間 |\n| 年 | 360時間 |\n\n## 特別条項(臨時的な特別の事情がある場合)\n\n原則の上限を超えて労働させる必要がある場合、**特別条項付きの36協定をあらかじめ締結・届出して\nいること**を前提に、以下の上限まで延長できます。特別条項がなければ、この延長は認められません。\n\n| 区分 | 上限 |\n| --- | --- |\n| 年間の時間外労働 | 720時間以内 |\n| 単月(休日労働を含む) | 100時間未満 |\n| 複数月平均(2〜6か月平均、休日労働を含む) | 80時間以内 |\n| 月45時間を超えられる回数 | 年6回まで |\n\n特別条項はあくまで「臨時的な特別の事情」がある月に限って使うためのものであり、\n恒常的に上限いっぱいまで労働させることを認める趣旨ではありません。",
    companyExample: "月40時間を超える見込みが立った時点で、所属長を通じて人事部にご相談ください。\n特別条項の適用は人事部が一元管理し、事前の承認を必要とします。",
  },
  "attendance.auto-break": {
    key: "attendance.auto-break",
    audience: ["employee","admin"],
    origin: "product",
    basis: "労働基準法34条(休憩)を前提とした KIZAMI の集計仕様",
    summary: "自動控除を有効にすると、休憩の打刻がなくても所定の休憩時間が実労働から差し引かれます。実際に休憩を取れなかった日は、打ち消しを申請すると控除されず、そのぶん休憩不足の警告が表示されます。",
    body: "# 休憩の自動控除\n\n会社の設定によっては、休憩の打刻をしなくても、勤務時間に応じた所定の休憩が\n実労働時間から自動的に差し引かれます。\n\n## 動作の種類\n\n| 設定 | 動作 |\n| --- | --- |\n| 打刻方式 | 打刻された休憩だけを差し引く(自動控除なし) |\n| 自動控除 | 打刻に関わらず、勤務時間に応じた所定の休憩を差し引く |\n| 併用 | 打刻された休憩を使い、所定の時間に満たない分だけ追加で差し引く |\n\n既定は**打刻方式**(自動控除はオフ)です。自動控除を使うかどうかは会社の設定次第で、\n有効にする場合は上表の「自動控除」または「併用」を選びます。\n\n自動控除された時間は、月次一覧で打刻由来の休憩とは**分けて表示**されます。\n「自分で打刻していないのに休憩が引かれている」ことに気づける必要があるためです。\n\n## 実際に休憩を取れなかったときは\n\n自動控除は「休憩を取ったはず」という前提で差し引く仕組みです。\n**実際には取れなかった日にそのまま差し引かれると、働いた時間が過少に記録されます。**\n\nその日について**打ち消し申請**を出してください。承認されると:\n\n- その日の自動控除がなくなり、実労働時間が打刻どおりに戻ります\n- 休憩が法律の最低時間(6時間超で45分、8時間超で60分)に足りていなければ、\n  休憩不足の警告が表示されます — これは会社が休憩を取らせる義務を\n  果たせていないことを示すもので、あなたの記録の誤りではありません\n\n## 途中で控除の基準を下回りそうな場合\n\n勤務6時間5分の日に45分を差し引くと、残りは5時間20分になり\n「6時間を超えたら45分」という前提そのものが崩れてしまいます。\nKIZAMI はこのような場合、**基準にちょうど載るところまでだけ控除します**\n(実労働が基準未満まで削られることはありません)。6時間5分の例では\n5分だけ差し引いて6時間ちょうどになり、それ以上は削られません。\n\nなお、差し引いた後がちょうど基準に載る場合は通常どおり全額控除されます。\n9時から18時まで9時間いて60分を差し引くと残りはちょうど8時間ですが、\nこれは「8時間勤務+昼休憩60分」という最も一般的な働き方そのものなので、\nそのとおりに記録されます。\n\n## 一斉付与・自由利用の原則との関係\n\n休憩には量(時間数)の規制(34条1項)のほかに、**一斉付与の原則**(34条2項。労使協定で例外可)と\n**自由利用の原則**(34条3項)があります。KIZAMI が検知・自動控除するのは打刻データから\n機械的に判定できる時間数のみで、休憩を一斉に与えたか・自由に利用できたかは検知対象外です。",
    companyExample: "当社は休憩の自動控除(6時間超で45分・8時間超で60分)を有効にしています。\n業務都合で休憩を取れなかった日は、当日中に打ち消し申請と所属長への報告をお願いします。",
  },
  "attendance.day-boundary": {
    key: "attendance.day-boundary",
    audience: ["employee","admin"],
    origin: "product",
    summary: "日界は「1日」の起算時刻の設定です。深夜勤務など日をまたぐ勤務は、日界を境にどちらの勤怠日に属するかが決まります。",
    body: "# 日界(1日の起算時刻)\n\n日界は、勤怠上の「1日」がいつからいつまでかを決める起算時刻です。多くのテナントは\n午前0時を日界にしますが、深夜勤務が多い職場では午前5時など別の時刻に設定できます。\n\n## 日をまたぐ勤務への影響\n\n日界より前の時刻の打刻は前日の勤務、日界以降の打刻は当日の勤務として扱われます。\nたとえば日界を午前5時に設定している場合、深夜1時から働き始めて朝6時に退勤しても、\n出勤・退勤とも同じ「勤務開始日」の勤怠として集計されます(日界の午前5時をまたいでいても\n分割されません)。\n\n日界の設定は、月次集計・フレックス収支・36協定アラートなど、日単位で行われる集計すべてに\n影響します。設定を変更すると、以後に発生する勤怠の日付の割り振り方が変わります。",
    companyExample: "当社の日界は午前5時です(深夜勤務が多い部署があるため)。\n午前5時より前に終業した分は前日の勤務として集計されます。",
  },
  "attendance.fixed-overtime": {
    key: "attendance.fixed-overtime",
    audience: ["employee","admin"],
    origin: "law",
    basis: "労働基準法32条1項・2項、37条1項(割増賃金)、昭和63年基発第1号(週の起算)",
    summary: "固定時間制の法定時間外は、まず1日8時間を超えた分を確定し、次にその週の法定内労働が週40時間を超えた分を加えます。この順序で計算しないと同じ労働を二重に数えてしまいます。",
    body: "# 固定時間制の時間外労働の数え方\n\n法定時間外労働は、**1日**と**1週**の両方で判定します(労働基準法32条)。\n\n## 判定の順序\n\n1. **1日の判定** — その日の実労働から8時間を引いた分が、その日の法定時間外労働です\n2. **1週の判定** — 1で時間外にならなかった分(法定内労働)を週の初めから積み上げ、\n   40時間を超えた分を法定時間外労働に加えます\n\n**この順序が重要です。** 先に週で判定すると、1日8時間超として既に時間外にした労働を\n週の集計にも入れてしまい、同じ労働を二度数えることになります。\n\n### 例:週6日、1日7時間働いた場合\n\n各日は8時間以内なので1の日次判定では時間外が出ません。\n一方で週の合計は42時間になるため、40時間を超えた**2時間**が週次の法定時間外労働です。\n\n### 例:週5日、うち1日だけ10時間働いた場合\n\n10時間の日に**2時間**の日次法定時間外が出ます。残る週の法定内労働は\n8時間 × 4日 + 8時間 = 40時間ちょうどなので、週次では追加されません。合計2時間です。\n\n## 週の起算日\n\n週40時間を判定するには週の区切りが必要です。就業規則に定めがない場合は\n**日曜日起算**が原則とされています(昭和63年基発第1号)。KIZAMI では会社ごとに設定できます。\n\n## 特例措置対象事業場でも1日8時間は変わりません\n\n商業・映画演劇業・保健衛生業・接客娯楽業で常時10人未満の事業場は、\n週の法定労働時間が44時間に緩和されます(労働基準法40条、労働基準法施行規則25条の2)。\n**緩和されるのは週だけで、1日8時間は動きません。**\n\n## 月をまたぐ週の扱い(KIZAMI の仕様)\n\nKIZAMI は月をまたぐ週について、**その月の期間内にある日だけ**で週40時間を判定します。\n前月分は持ち越しません。\n\n締めた月の数字が後から動かないことを優先した仕様です。このため月初の週では、\n週次の法定時間外が実際より少なく出ることがあります。月初にまたがる長時間労働がある場合は、\n月次一覧の日別の実労働時間もあわせて確認してください。",
    companyExample: "時間外労働は事前申請制です。所属長の承認を得たうえで行ってください。\n当社の週の起算日は日曜日です(就業規則第○条)。",
  },
  "attendance.flex-frame": {
    key: "attendance.flex-frame",
    audience: ["employee","admin"],
    origin: "law",
    basis: "労働基準法32条・32条の3(フレックスタイム制の清算期間)",
    summary: "月の総枠は「週の法定労働時間 × その月の暦日数 ÷ 7」で決まります。実績がこの枠を超えた分が時間外労働になります。",
    body: "# フレックスタイム制の総枠\n\nフレックスタイム制では、1日ごとではなく**清算期間(この設定では1か月)の合計**で\n労働時間を判断します。その期間に働くべき時間の上限を「総枠」と呼びます。\n\n```\n総枠 = 週の法定労働時間 × その月の暦日数 ÷ 7\n```\n\n週の法定労働時間は原則40時間です。例外として、商業・映画演劇業・保健衛生業・接客娯楽業で\n常時10人未満の事業場([特例措置対象事業場](./tenant-special-provision))は44時間になります。\n\n| 月の日数 | 週40時間の場合 | 週44時間の場合 |\n| --- | --- | --- |\n| 30日 | 171時間25分 | 188時間34分 |\n| 31日 | 177時間8分 | 194時間51分 |\n\n実績が総枠を超えた分が**時間外労働**、下回った分が**不足**です。KIZAMI の月次画面では\n「フレックス収支」として表示されます。\n\n## 有給を取った日の扱い\n\n年次有給休暇を取得した日は、働いたものとして実績に算入されます(全休なら所定労働時間分、\n半休なら半分、時間単位ならその時間分)。有給を取ったことで不足が増えることはありません。",
  },
  "attendance.late-night": {
    key: "attendance.late-night",
    audience: ["employee","admin"],
    origin: "law",
    basis: "労働基準法37条4項",
    summary: "22時〜翌5時の労働は深夜労働として25%以上の割増賃金の対象になります。時間外労働と重なる場合は割増率が合算されます。",
    body: "# 深夜労働(22時〜翌5時)の割増\n\n**午後10時から翌午前5時まで**の間に働いた時間は深夜労働として扱われ、通常の賃金に加えて\n**25%以上**の割増賃金の対象になります(労働基準法37条4項)。\n\n## 重なったときは合算される\n\n深夜労働は、時間外労働や休日労働と同時に発生することがあります。その場合、割増率は**合算**されます。\n\n| 組み合わせ | 割増率の目安 |\n| --- | --- |\n| 深夜労働のみ | 25%以上 |\n| 時間外労働 + 深夜労働 | 50%以上(25%+25%) |\n| 法定休日労働 + 深夜労働 | 60%以上(35%+25%) |\n\n## KIZAMI の範囲\n\nKIZAMI は打刻から深夜帯(22時〜翌5時)に該当する時間数を区分して集計するところまでを行います。\n実際の割増賃金額の計算・支払いは、集計結果をもとに給与計算側で行ってください。",
  },
  "attendance.legal-holiday": {
    key: "attendance.legal-holiday",
    audience: ["employee","admin"],
    origin: "law",
    basis: "労働基準法35条・37条1項",
    summary: "法定休日は毎週少なくとも1日(または4週を通じて4日)の休日です。会社が定める所定休日とは別の概念で、法定休日の労働だけが35%以上の割増(休日労働)の対象になります。",
    body: "# 法定休日と所定休日の違い\n\n**法定休日**とは、労働基準法35条が使用者に義務付ける最低限の休日で、**毎週少なくとも1日**、\nまたは**4週を通じて4日以上**のいずれかを与える必要があります。\n\n**所定休日**は、会社が就業規則等で定めるそれ以外の休日(いわゆる「土日休み」の片方など)です。\n法律上の最低ラインを超えて会社が任意に設けているもので、KIZAMI ではこの2つを区別して扱います。\n\n## 割増賃金がかかるのは法定休日労働だけ\n\n| 休日の種類 | その日に働いた場合 |\n| --- | --- |\n| 法定休日 | 休日労働として**35%以上**の割増(労基法37条1項) |\n| 所定休日(法定休日以外) | 休日労働の割増は付かない。ただしその週の労働時間が週40時間を超えれば時間外労働として25%以上の割増 |\n\n「休みの日に働いたら常に35%増し」と誤解されがちですが、35%の割増が発生するのは法定休日に\n働いた場合だけです。所定休日の労働は、法定休日労働ではなく時間外労働として扱われます。",
  },
  "attendance.minute-unit": {
    key: "attendance.minute-unit",
    audience: ["employee","admin"],
    origin: "law",
    basis: "労働基準法24条・37条、昭63.3.14基発150号",
    summary: "労働時間は1日ごとに1分単位で把握するのが原則です。労働者に不利益な切り捨ては、賃金の全額払い(労基法24条)・割増賃金(労基法37条)に反すると判断される場合があります。",
    body: "# 労働時間の端数処理(1分単位)\n\n労働時間は、日々の実績を**1分単位**で計算するのが原則です。「15分未満切り捨て」「30分未満切り捨て」\nのように、実際に働いた時間より短く丸めて賃金を減らす扱いは、労働基準法24条(賃金の全額払い)や\n37条(割増賃金の支払い)に反すると判断される場合があります。\n\n## 唯一の例外: 1か月の合計への端数処理\n\n日々の労働時間そのものを丸めることはできませんが、**1か月分の時間外・休日・深夜労働の合計**に\n1時間未満の端数が生じた場合に限り、30分未満を切り捨て・30分以上を切り上げる扱いが認められています\n(昭63.3.14基発150号)。\n\n| 対象 | 端数処理 |\n| --- | --- |\n| 日々の労働時間 | 切り捨て不可(1分単位で計算) |\n| 1か月の時間外労働などの合計 | 30分未満切り捨て・30分以上切り上げが可能 |\n\n「日々の打刻を丸めてよい」と誤解されがちですが、認められているのは月単位の合計に対してだけです。",
  },
  "attendance.warnings": {
    key: "attendance.warnings",
    audience: ["employee","admin"],
    origin: "product",
    summary: "打刻が不完全なとき、KIZAMIは足りない・矛盾した部分を保守的に解釈します。対応する打刻がない区間は集計に含めず、つじつまの合わない打刻は無効化します。",
    body: "# 打刻が不完全なときの扱い\n\n打刻忘れや誤操作で、出退勤や休憩の打刻が揃わないことがあります。KIZAMI はこうしたケースを\n**保守的に解釈**します。\n\n## 保守的に解釈する理由\n\n労働時間は「実際に働いた時間」を正しく記録する必要があります。打刻が欠けている区間を\n推測で埋めて労働時間としてカウントしてしまうと、実態より多い(あるいは少ない)労働時間を\n記録することになりかねません。KIZAMI は、確証のない区間を労働時間として捏造しないために、\n**足りない情報は集計に含めない**方針をとっています。実際の労働時間と食い違う場合は、\n修正申請で正しい打刻を補ってください。\n\n## 主なパターン\n\n| 状況 | KIZAMI の扱い |\n| --- | --- |\n| 退勤の打刻が無い | その勤務区間は集計から除外する(働いた時間として数えない) |\n| 勤務中に重複した出勤打刻がある | 後の重複した出勤打刻を無効にする |\n| 出勤していない状態での退勤打刻 | その退勤打刻を無効にする |\n| 勤務外での休憩打刻 | その休憩打刻を無効にする |\n| 休憩中に重複した休憩開始打刻がある | 後の重複した休憩開始打刻を無効にする |\n| 対応する休憩開始が無い休憩終了打刻 | その休憩終了打刻を無効にする |\n| 休憩中に退勤打刻がある | 休憩を終えて退勤したものとして扱う |\n\nこれらは月次画面の警告列に表示されます。実際の労働時間と異なる場合は、その日の「修正」から\n正しい打刻を申請してください。",
  },
  "attendance.work-system": {
    key: "attendance.work-system",
    audience: ["employee","admin"],
    origin: "law",
    basis: "労働基準法32条(労働時間)・32条の3(フレックスタイム制)",
    summary: "労働時間制によって「時間外労働」の意味が変わります。固定時間制は1日8時間・1週40時間を超えた分、フレックスタイム制は清算期間(1ヶ月)の総枠を超えた分が時間外労働です。",
    body: "# 労働時間制と「時間外」の意味\n\n同じ「1日10時間働いた」でも、適用されている労働時間制によって時間外労働になるかどうかが変わります。\n\n## 固定時間制\n\n**1日8時間・1週40時間**という上限があり、これを超えた分がその場で時間外労働になります\n(労働基準法32条)。月末を待たずに、その日のうちに確定します。\n\n所定労働時間が7時間の会社で7時間30分働いた場合、この30分は所定を超えていますが\n1日8時間以内なので**法定時間外にはあたりません**。割増賃金は不要ですが、\n働いた分の賃金は当然に支払われます。KIZAMI ではこれを「法定内残業」として区別して表示します。\n\n## フレックスタイム制\n\n清算期間(KIZAMI では1ヶ月)の**総枠**と実績を比べ、超えた分が時間外労働になります\n(労働基準法32条の3)。総枠は「週の法定労働時間 × その月の暦日数 ÷ 7」で決まります。\n\n**1日単位の時間外労働という概念がありません。** ある日に10時間働いても、\n月の総枠に収まっていれば時間外労働ではありません。始業・終業の時刻を自分で決められることが\nこの制度の趣旨なので、日ごとに上限を設けない仕組みになっています。\n\nこのため、フレックスタイム制が適用されている方の月次一覧には**時間外の列が表示されません**。\n表示していないのではなく、その日にはまだ決まっていない、というのが正確です。\n月の途中の見込みは「フレックス収支」で確認できます。\n\n## どちらでも変わらないもの\n\n次のものは労働時間制にかかわらず同じように扱われます。\n\n| | 内容 |\n| --- | --- |\n| 深夜労働 | 22時〜翌5時の労働。25%以上の割増(労働基準法37条4項) |\n| 法定休日労働 | 週1日の法定休日の労働。35%以上の割増(労働基準法37条1項) |\n| 休憩 | 6時間超で45分、8時間超で60分(労働基準法34条) |\n| 年次有給休暇 | 付与日数・年5日の取得義務(労働基準法39条) |",
    companyExample: "当社は原則としてフレックスタイム制(清算期間1ヶ月・コアタイムなし)を適用します。\n適用される制度は雇用契約書に記載しています。ご自身の制度が分からない場合は人事部にお問い合わせください。",
  },
  "closing.amend": {
    key: "closing.amend",
    audience: ["admin"],
    origin: "product",
    summary: "締め後修正は、月の確定を解除せずに承認された1件分の変更だけを反映する仕組みです。反映後も当初の締め時点の数値との差分が表示され続けます。",
    body: "# 締め後修正\n\n締め済みの月に対する修正申請や休暇申請が承認された場合、月全体の確定を解除しなくても、\nその**1件分の変更だけ**を反映して該当ユーザーの集計を再計算できます。月は締められたままです。\n\n## 当初値との差分が残る\n\n締め後修正を反映すると、その月は「締め後に修正あり」の状態になります。締めた時点の当初の\n数値と、修正を反映した後の現在の数値の両方が保持され、月次画面には**当初値との差分**が\n表示され続けます。どの区分がどれだけ変わったかを、後から追跡できます。\n\n## 締めの解除との違い\n\n| 操作 | 影響範囲 | 月の状態 |\n| --- | --- | --- |\n| 締めの解除 | 月全体を自由に編集可能にする | 未確定に戻る |\n| 締め後修正 | 承認された1件分だけを反映する | 確定済みのまま(差分が記録される) |\n\n月を開けずに済む分、締め後修正は影響範囲の小さい変更向けです。月全体を見直す必要がある場合は\n締めの解除を使ってください。",
  },
  "closing.execute": {
    key: "closing.execute",
    audience: ["employee","admin"],
    origin: "product",
    summary: "月次締めを行うと、その月の勤怠記録が確定し、以後の打刻・修正には申請と承認が必要になります。確定した時点の数値はスナップショットとして固定されます。",
    body: "# 月次締め\n\n締めは、対象月の勤怠記録を「確定」させる操作です。締めた時点の区分別合計・フレックス収支などの\n数値は**スナップショット**として固定され、以後は打刻や集計方法が変わっても遡って変化しません。\n\n## 締めた後の扱い\n\n- 締め後は打刻の追加・訂正・取消ができなくなり、変更するには**修正申請とその承認**が必要になります\n- 締めを解除(確定解除)すると、その月は再び自由に編集できる状態に戻ります。解除には別途の権限が必要です\n- 締め・解除・締め後修正のすべての操作は監査ログに記録されます\n\n締めは給与計算などの後続処理の起点になるため、締めた月の数字が意図せず変わらないようにする\nための仕組みです。",
    companyExample: "毎月5日に前月分を締めます。それまでに修正申請を完了してください。\n締め後の修正が必要な場合は、所属長経由で人事部にご連絡ください。",
  },
  "closing.unlock": {
    key: "closing.unlock",
    audience: ["admin"],
    origin: "product",
    summary: "確定済みの月次締めを解除して、その月の勤怠記録を再び修正できる状態に戻します。解除・再修正・再締めの操作はすべて監査ログに記録されます。",
    body: "# 締めの解除\n\n月次締めを解除すると、確定していたその月の勤怠記録が再び修正可能になります。\n\n- この操作には「締めの解除」権限が必要です\n- 給与計算にすでに使われた月を解除する場合は、エクスポート先との整合に注意してください\n- 誰がいつ解除したかは締め状態の履歴として保持され、監査ログからも確認できます",
  },
  "correction.flow": {
    key: "correction.flow",
    audience: ["employee","admin"],
    origin: "product",
    summary: "打刻は直接編集できません。追加・訂正・取消はすべて修正申請として提出し、承認されて初めて勤怠記録に反映されます。承認・却下・取下げを含むすべての変更は監査ログに記録されます。",
    body: "# 打刻修正申請の流れ\n\n打刻の記録そのものを直接書き換えることはできません。打刻を追加・訂正・取り消したい場合は、\n**修正申請**として提出し、承認された結果としてのみ勤怠記録に反映されます。\n\n## 申請の種類\n\n- **追加**: 打刻し忘れた出退勤・休憩を新規に登録する申請\n- **訂正**: 既存の打刻の時刻や種別を変更する申請\n- **取消**: 既存の打刻を無かったことにする申請\n\n## 承認までの流れ\n\n1. 本人(または代理権限を持つ担当者)が理由を添えて申請する(状態: 申請中)\n2. 承認権限を持つ担当者が内容を確認し、承認または却下する\n3. 承認されると打刻に反映され、月次集計に反映される。却下された場合は反映されない\n4. 申請中の間は、本人が取り下げることもできる\n\n対象月がすでに締められている場合は、承認するために確定解除の権限が別途必要です。\n\n## すべて監査ログに残る\n\n申請の提出・承認・却下・取下げは、いつ・誰が行ったかを含めてすべて監査ログに記録されます。\n承認者と申請者が同一人物の場合(自己承認)も、その旨が記録として残ります。",
    companyExample: "申請は対象日の翌営業日中に提出してください。\n繁忙期(月末最終3営業日)の承認は翌営業日にずれ込む場合があります。",
  },
  "law.versioning": {
    key: "law.versioning",
    audience: ["admin"],
    origin: "product",
    summary: "法改正はあらかじめ登録された施行日を迎えると自動的に切り替わります。過去の期間の計算は、その期間の当時に有効だった法令のまま変わりません。",
    body: "# 法改正の自動切り替え\n\nKIZAMI は、労働基準法などの法令ルールを「施行日付きの版」として管理しています。将来の法改正を\n施行前にあらかじめ登録しておくと、その施行日を迎えた瞬間に自動的に新しいルールへ切り替わり、\nテナントプロファイル画面には適用予定の法改正として事前に表示されます。\n\n## 過去の期間は当時のルールのまま\n\n法改正が反映されるのは施行日以降の期間だけです。すでに締められた月はもちろん、締められて\nいない過去の月であっても、集計に使われる法令ルールはその**期間の当時に有効だったもの**です。\n最新のルールで過去分が遡って再計算されることはありません。\n\nこれにより、法改正のたびに過去の集計結果が変わってしまう(締め済みの数字と食い違う)ことを\n防いでいます。",
  },
  "leave.grant": {
    key: "leave.grant",
    audience: ["employee","admin"],
    origin: "law",
    basis: "労働基準法39条1項・2項、115条",
    summary: "年次有給休暇は、入社から6か月継続勤務し全労働日の8割以上出勤すると10日付与され、以後勤続年数に応じて最大20日まで増えます。付与された休暇は付与日から2年で時効消滅します。",
    body: "# 年次有給休暇の法定付与日数と時効\n\n雇入れの日から**6か月間継続勤務**し、その間の全労働日の**8割以上出勤**した労働者には、\n年次有給休暇が付与されます(労働基準法39条1項)。以後、勤続年数に応じて日数が増えていきます\n(同条2項)。\n\n## 勤続年数ごとの付与日数(フルタイムの場合)\n\n| 勤続年数 | 付与日数 |\n| --- | --- |\n| 6か月 | 10日 |\n| 1年6か月 | 11日 |\n| 2年6か月 | 12日 |\n| 3年6か月 | 14日 |\n| 4年6か月 | 16日 |\n| 5年6か月 | 18日 |\n| 6年6か月以降 | 20日 |\n\nいずれの区分も、対象期間の全労働日の8割以上出勤していることが条件です。\n\n## 週の所定労働日数が少ない場合(比例付与)\n\n週の所定労働時間が30時間未満で、かつ週の所定労働日数が4日以下(週以外の期間で定める場合は\n年間の所定労働日数が216日以下)の労働者には、上記の表とは別に**比例付与**の日数表が\n適用されます(労基法39条3項、労基法施行規則24条の3)。\n\n| 週の所定労働日数 | 6か月 | 1年6か月 | 2年6か月 | 3年6か月 | 4年6か月 | 5年6か月 | 6年6か月以降 |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| 4日 | 7日 | 8日 | 9日 | 10日 | 12日 | 13日 | 15日 |\n| 3日 | 5日 | 6日 | 6日 | 8日 | 9日 | 10日 | 11日 |\n| 2日 | 3日 | 4日 | 4日 | 5日 | 6日 | 6日 | 7日 |\n| 1日 | 1日 | 2日 | 2日 | 2日 | 3日 | 3日 | 3日 |\n\nKIZAMI はメンバーごとの「有給付与の区分」に応じてこの表で日数を計算します。区分は\n週の所定労働時間・日数から自動判定せず、**管理者が就業規則・雇用契約に基づいて設定**します\n(メンバー管理画面)。区分が未設定のメンバーは通常(週5日以上)として扱われます。\n\nなお、比例付与であっても**1回の付与日数が10日以上になれば年5日取得義務の対象**です\n(週4日区分の3年6か月=10日など)。\n\n## 時効は2年\n\n付与された年次有給休暇は、**付与日から2年**で時効により消滅します(労基法115条)。前年度分の\n未消化が当年度に繰り越されるのはこの2年以内の分だけです。",
    companyExample: "当社は法定を上回る取扱いとして、入社日に前倒しで5日を付与しています。\n詳細は就業規則第◯条をご確認ください。",
  },
  "leave.hourly": {
    key: "leave.hourly",
    audience: ["employee","admin"],
    origin: "law",
    basis: "労働基準法39条4項、平21.5.29基発0529001号",
    summary: "時間単位で年次有給休暇を取得できるのは、労使協定がある場合に限り、年5日分までです。1日あたりの時間数は所定労働時間を1時間単位に切り上げて計算します。",
    body: "# 時間単位の年次有給休暇\n\n年次有給休暇は原則として1日単位で取得するものですが、**労使協定を結んでいる場合に限り**、\n時間単位で取得できます。\n\n## 年5日分が上限\n\n時間単位で取得できるのは**年5日分まで**です。これは法律上の上限で、労使協定で\nこれより少なく定めることはできますが、超えることはできません。\n\n「5日分」の時間数は、1日の所定労働時間を**1時間単位に切り上げて**計算します。\n\n| 所定労働時間 | 1日あたり | 年5日分 |\n| --- | --- | --- |\n| 8時間 | 8時間 | 40時間 |\n| 7時間30分 | **8時間**(切り上げ) | 40時間 |\n| 7時間 | 7時間 | 35時間 |\n\n前年度から繰り越した年次有給休暇を時間単位で取る場合も、**当年度の5日の枠に含めて**\n数えます。繰越分だから別枠、にはなりません。\n\n## 年5日の取得義務には数えられない\n\n時間単位の取得は、[年5日の取得義務](./leave-mandatory-five-days)を満たすための取得\nとしては認められません。義務を満たすには全休または半休で取得する必要があります。",
    companyExample: "当社は1時間単位で取得できます(労使協定による)。\n半日を超える取得を希望する場合は、半休を利用してください。",
  },
  "leave.mandatory-five-days": {
    key: "leave.mandatory-five-days",
    audience: ["employee","admin"],
    origin: "law",
    basis: "労働基準法39条7項・8項(2019年4月1日施行)",
    summary: "年10日以上の年次有給休暇が付与された人は、付与日から1年以内に5日取得する必要があります。半休は0.5日として数えられますが、時間単位の取得は数えられません。",
    body: "# 年5日の取得義務\n\n年10日以上の年次有給休暇が付与された人は、**付与日から1年以内に5日**取得する必要があります。\nこれは働く人の権利であると同時に、会社に課された義務でもあります。\n\n## 数え方に注意\n\n| 取得の単位 | 5日にカウントされるか |\n| --- | --- |\n| 全休 | 1.0日として数えられる |\n| 半休(午前・午後) | **0.5日として数えられる** |\n| 時間単位 | **数えられない** |\n\n時間単位の年次有給休暇は、この5日の義務を満たすための取得としては認められません。\n時間単位で40時間取得しても、義務の充足は0日のままです。義務を満たすには、\n全休または半休で取得する必要があります。\n\n## 期限\n\n期限は「付与日から1年後」です。付与日は人によって違うため(入社日基準の場合)、\n期限も人によって異なります。KIZAMI の有給休暇画面で、自分の期限と残り日数を確認できます。\n\n期限が近づくと通知が届きます(90日前・30日前)。",
    companyExample: "取得予定は毎年4月末までに所属長へ申し出てください。\n未消化が3日以上残っている方には、10月に人事から個別にご連絡します。",
  },
  "overtime.60h": {
    key: "overtime.60h",
    audience: ["employee","admin"],
    origin: "law",
    basis: "労働基準法37条1項ただし書(2010年4月1日施行、中小企業は2023年4月1日から適用)",
    summary: "1か月に60時間を超える時間外労働は、超えた部分の割増賃金率が50%以上になります。中小企業には猶予がありましたが、2023年4月1日からはすべての企業に適用されています。",
    body: "# 月60時間超の時間外労働の割増率\n\n1か月の時間外労働が**60時間を超えた**場合、その**超えた部分**については割増賃金率が\n**50%以上**になります(労働基準法37条1項ただし書)。\n\n## 60時間までの部分は変わらない\n\n50%になるのは60時間を超えた部分だけで、60時間までの部分は通常の時間外労働の割増率\n(25%以上)のままです。「月60時間を超えたら全部50%」ではありません。\n\n| 時間外労働の区分 | 割増率 |\n| --- | --- |\n| 60時間まで | 25%以上 |\n| 60時間を超えた部分 | 50%以上 |\n\n## 中小企業の猶予は終了している\n\nこの50%ルールは大企業には2010年4月1日から適用されていましたが、中小企業には猶予措置が\nありました。**2023年4月1日**からは中小企業にも適用されており、現在は企業規模を問わず\n同じルールが適用されます。",
  },
  "permission.presets": {
    key: "permission.presets",
    audience: ["admin"],
    origin: "product",
    summary: "権限プリセットは複数を割り当てると合算され、承認・実行などの操作系の権限には対応する閲覧権限が自動的に含まれます。特定の権限を打ち消す拒否ルールはありません。",
    body: "# 権限プリセットの考え方\n\n権限プリセットは、権限のON/OFFと適用範囲(スコープ)を組み合わせて定義する、割り当て単位です。\n\n## 複数割当は合算される\n\n1人のメンバーに複数のプリセットを割り当てた場合、持てる権限は**合算(足し算)**されます。\n同じ権限に異なるスコープが割り当てられている場合は、広い方のスコープが有効になります。\n\n## 操作は閲覧を含意する\n\n承認・実行・管理などの操作系の権限をONにすると、その操作に必要な範囲の閲覧権限は\n自動的に有効になります。たとえば「打刻修正申請を承認できる」をONにすると、対象範囲の\n修正申請・勤怠記録の閲覧も別途ONにしなくても行えます。\n\n## 拒否(deny)ルールは存在しない\n\nKIZAMI の権限モデルには、特定の権限を明示的に打ち消す「拒否」ルールがありません。\n複数のプリセットを割り当てた結果、意図せず広い権限を持たせてしまわないよう、割当時には\nそれぞれのプリセットが実際にONにしている権限の一覧を確認してください。",
  },
  "privacy.internal-terms-template": {
    key: "privacy.internal-terms-template",
    audience: ["employee","admin"],
    origin: "product",
    summary: "正確な打刻の義務・代理打刻の禁止など、打刻に関する社内利用規約の雛形を「設定 > 個人情報」画面から取得できます。",
    body: "# 打刻に関する社内利用規約の雛形\n\n正確な打刻の義務・代理打刻の禁止・打刻を忘れた場合の修正申請の手続き・不正打刻の扱いを\nまとめた社内利用規約の雛形を、「設定 > 個人情報」画面から取得できます。\n\nこの雛形はそのまま就業規則の一部にする、あるいは別紙として従業員に周知するなど、\n自社の運用に合わせて活用してください。就業規則へのリンクを設定している場合は、\n雛形の末尾に自動的に案内が付きます。",
    companyExample: "本規約は就業規則第◯条(服務規律)の一部として扱います。違反時の取扱いは就業規則の懲戒規定によります。",
  },
  "privacy.notice-template": {
    key: "privacy.notice-template",
    audience: ["employee","admin"],
    origin: "product",
    summary: "打刻・IP・UA・GPS座標などの個人情報について、従業員に公表するプライバシー通知の雛形を「設定 > 個人情報」画面から取得できます。現在のGPS設定・保存期間から自動生成されます。",
    body: "# 従業員向けプライバシー通知の雛形\n\n打刻記録・IPアドレス・ユーザーエージェント・GPS座標(有効な場合)は従業員の個人情報です。\nこれらの取得目的・保存期間を従業員に公表する義務(個人情報保護法第17条・第18条・第21条)を\n負うのは、KIZAMI プロジェクトではなく**導入企業**です。\n\nKIZAMI は「設定 > 個人情報」画面から、現在のテナント設定(GPSの有効/無効・保持期間)を\n反映したプライバシー通知の雛形を自動生成します。GPSが無効な場合は位置情報に関する項目は\n表示されません。\n\n## 使い方\n\n1. 「設定 > 個人情報」画面で生成された文面を確認する\n2. 自社の実情(開示・訂正の請求窓口など)に合わせて見直す\n3. 従業員へ周知する(掲示・イントラ掲載・雇用契約書への添付など、方法は自社で選ぶ)\n\n生成される文面はあくまで雛形であり、法的助言ではありません。内容に不安がある場合は\n社会保険労務士・弁護士等の専門家に確認してください。",
    companyExample: "当社では2026年8月に本雛形をもとにプライバシー通知を作成し、イントラの「お知らせ」に掲載しました。\n改定した場合は、掲載日をここに追記してください。",
  },
  "privacy.retention-after-leaving": {
    key: "privacy.retention-after-leaving",
    audience: ["employee","admin"],
    origin: "law",
    basis: "労働基準法109条・附則143条2項、個人情報保護法22条",
    summary: "退職後も勤怠記録は法律で保存が義務づけられています(原則5年、経過措置により当分の間3年)。この期間が経過した後、氏名・メールアドレスなどの個人を特定できる情報は消去されますが、勤怠記録そのものは残ります。",
    body: "# 退職後の記録の保存と消去\n\n退職しても、勤怠の記録がすぐに消えるわけではありません。**法律が保存を義務づけている**ためです。\n\n## 2つの法律が逆を向いている\n\n| 法律 | 求めていること |\n| --- | --- |\n| 労働基準法109条 | 賃金台帳・出勤簿等の記録を**保存しなければならない**(原則5年。附則143条2項の経過措置により当分の間3年) |\n| 個人情報保護法22条 | 利用する必要がなくなった個人データは**遅滞なく消去するよう努めなければならない** |\n\n退職者について、この2つは正面からぶつかります。記録を消せば労働基準法に反し、\n残し続ければ個人情報保護法の努力義務に反する、という形です。\n\n保存義務が「しなければならない」(義務)で、消去が「努めなければならない」(努力義務)である\n以上、**保存期間が経過するまでは残す**のが正しい順序です。\n\n## 保存期間の起算日\n\n労働基準法109条の保存期間は「最後の記載日」から数えます。退職者の場合、最後の勤怠記録が\nその日にあたります。KIZAMI は**退職処理を行った日**を起算日として扱います。退職処理は\n最終出勤日以降に行われるため、この扱いは実際の起算日より**後ろ**になることはあっても\n前になることはなく、義務期間を割り込みません。\n\n## 期間の経過後に何が起きるか\n\n保持期間が過ぎると、管理者は退職者の個人データを消去できるようになります。\nこのとき消えるものと残るものは次のとおりです。\n\n| 対象 | 扱い |\n| --- | --- |\n| 氏名・メールアドレス | 個人を識別できない表記に置き換える |\n| パスワード・二要素認証・ログイン情報 | 削除する |\n| 通知の設定・端末の情報(IPアドレス・ブラウザ情報・位置情報) | 削除する |\n| 勤怠記録(打刻の時刻・集計結果・締めた月の数字) | **残す**(保存義務のため) |\n| 監査ログ | **残す**(改変しない。表示される氏名だけが匿名化される) |\n\nつまり「記録を消す」のではなく、**記録から『誰の記録か』を取り除く**操作です。\n勤怠記録の行そのものが消えないため、過去に締めた月の集計値は消去の前後で変わりません。\n\nこの操作は**取り消せません**。退職後にご自身の記録の開示を希望される場合は、\n保持期間が経過する前に会社の窓口へご連絡ください。\n\n## 保持期間は会社が選びます\n\n3年(経過措置)と5年(原則)のどちらを採るかは会社が決めます。KIZAMI の既定は**5年**です\n— 経過措置はいつか終了し、そのとき3年のままにしていると保存義務を満たせなくなるためです。",
    companyExample: "当社は保持期間を3年(経過措置)としています。\n退職後にご自身の記録の開示を希望される場合は、この期間内に人事部までご連絡ください。",
  },
  "tenant.special-provision": {
    key: "tenant.special-provision",
    audience: ["admin"],
    origin: "law",
    basis: "労働基準法40条、労働基準法施行規則25条の2",
    summary: "商業・映画演劇業・保健衛生業・接客娯楽業で常時10人未満の事業場は、週の法定労働時間が44時間になります。過去の経過措置ではなく現行の制度です。",
    body: "# 特例措置対象事業場(週44時間)\n\n週の法定労働時間は原則40時間ですが、次の条件を**両方**満たす事業場は**44時間**になります。\n\n1. 業種が **商業・映画演劇業・保健衛生業・接客娯楽業** のいずれか\n2. 常時使用する労働者が **10人未満**\n\nこれは1997年の週40時間制完全実施のときに設けられたもので、過去の経過措置ではなく\n**現在も生きている制度**です。\n\n## 集計への影響\n\n週の法定労働時間は[フレックスタイム制の総枠](./attendance-flex-frame)の計算に使われるため、\n該当するかどうかで月の総枠が変わります。\n\n| 月の日数 | 週40時間 | 週44時間 |\n| --- | --- | --- |\n| 30日 | 171時間25分 | 188時間34分 |\n| 31日 | 177時間8分 | 194時間51分 |\n\n30日の月でおよそ17時間の差が出ます。**該当するのに設定していないと、本来は時間外でない労働が\n時間外として計上されます。**\n\n## 設定と見直し\n\n「設定 → テナントプロファイル」で切り替えます。判定は事業場単位なので、\n**従業員数が10人以上になった時点で該当しなくなります**。人数の増減があったときは\n設定を見直してください(KIZAMI は人数から自動判定しません)。",
    companyExample: "当事業場は小売業・従業員7名のため特例措置対象事業場に該当します(2026年4月時点)。\n従業員数が10名以上になった場合は、速やかに設定を見直してください。",
  },
};

/**
 * ロケール → キー → ヘルプエントリ。
 *
 * 訳文ロケールの値の型が `Partial<...>` なのは意図的で、翻訳が1件でも欠ければ
 * 参照側は必ず undefined を扱う(= フォールバックを書く)ことになる。
 * 「生成時に黙って日本語で埋める」設計にすると、訳文が無いことが型からも実行時からも
 * 見えなくなり、翻訳漏れが永久に発見されない。欠落キーは HELP_MISSING_KEYS と
 * `pnpm --filter @kizami/help-content test` の完全性テストで可視化する。
 *
 * 参照するときは src/index.ts の `helpEntryFor(key, locale)` を使うこと(フォールバック込み)。
 */
export const HELP_BY_LOCALE: Record<HelpLocale, Partial<Record<HelpKey, HelpEntry>>> = {
  ja: HELP,
  en: {
    "agreement36.limits": {
      key: "agreement36.limits",
      audience: ["employee","admin"],
      origin: "law",
      basis: "Article 36(4), (5) and (6) of the Labor Standards Act (in force from April 1, 2019; from April 1, 2020 for small and medium-sized enterprises)",
      summary: "Overtime work that a 36協定 (Article 36 agreement) can extend is limited in principle to 45 hours per month and 360 hours per year. Only where temporary special circumstances exist can a special clause in the labor-management agreement extend it to limits such as 720 hours per year, and those limits also cap how many months may exceed the general limit and the multi-month average.",
      body: "# Upper limits under the Article 36 agreement\n\nTo have workers perform overtime work or work on holidays, a 36協定 (Article 36 agreement, a labor-management agreement) must be concluded and filed in advance.\nThe hours by which working time may be extended are subject to upper limits backed by penalties (Article 36(4) to (6) of the Labor Standards Act).\n\n## General rule (limit on extended working hours)\n\n| Period | Limit |\n| --- | --- |\n| Month | 45 hours |\n| Year | 360 hours |\n\n## Special clause (where temporary special circumstances exist)\n\nWhere it is necessary to have workers work beyond the general limits, hours may be extended up to the limits\nbelow, on condition that **an Article 36 agreement with a special clause has been concluded and filed in\nadvance**. Without a special clause, this extension is not permitted.\n\n| Period | Limit |\n| --- | --- |\n| Overtime work per year | 720 hours or less |\n| A single month (including work on holidays) | Less than 100 hours |\n| Multi-month average (average over 2 to 6 months, including work on holidays) | 80 hours or less |\n| Number of times a month may exceed 45 hours | Up to 6 times per year |\n\nA special clause is meant to be used only in months where there are \"temporary special circumstances\";\nit is not intended to permit working up to the maximum limits on an ongoing basis.",
      companyExample: "Once your hours are expected to exceed 40 hours in a month, consult the HR department through your supervisor.\nUse of the special clause is managed centrally by the HR department and requires prior approval.",
    },
    "attendance.auto-break": {
      key: "attendance.auto-break",
      audience: ["employee","admin"],
      origin: "product",
      basis: "KIZAMI aggregation behavior built on Article 34 of the Labor Standards Act (rest periods)",
      summary: "When automatic deduction is enabled, the prescribed rest period is subtracted from actual working hours even without rest period punches. On a day when you could not actually take a rest period, submitting a cancellation request removes the deduction, and a rest period shortfall warning appears accordingly.",
      body: "# Automatic deduction of rest periods\n\nDepending on the company's settings, the prescribed rest period for the hours worked is subtracted from\nactual working hours automatically, even without rest period punches.\n\n## Types of behavior\n\n| Setting | Behavior |\n| --- | --- |\n| Time punch method | Subtracts only rest periods that were punched (no automatic deduction) |\n| Automatic deduction | Subtracts the prescribed rest period for the hours worked, regardless of punches |\n| Combined | Uses the rest periods that were punched and additionally subtracts only the shortfall against the prescribed time |\n\nThe default is the **time punch method** (automatic deduction off). Whether automatic deduction is used\ndepends on the company's settings; to enable it, either \"Automatic deduction\" or \"Combined\" in the table\nabove is selected.\n\nAutomatically deducted time is **shown separately** from punch-derived rest periods in the monthly list.\nThis is so that you can notice that \"a rest period is being deducted even though I did not punch it\".\n\n## When you could not actually take a rest period\n\nAutomatic deduction subtracts on the assumption that a rest period was taken.\n**If it is subtracted as-is on a day when you could not actually take one, your working hours are recorded as\nless than they were.**\n\nSubmit a **cancellation request** for that day. Once it is approved:\n\n- The automatic deduction for that day is removed, and actual working hours return to what the punches show\n- If the rest period falls short of the statutory minimum (45 minutes over 6 hours, 60 minutes over 8 hours),\n  a rest period shortfall warning is displayed — this indicates that the company has not met its\n  obligation to let workers take a rest period, not that your records are wrong\n\n## When the deduction would drop you below the threshold\n\nOn a day with 6 hours 5 minutes of work, subtracting 45 minutes would leave 5 hours 20 minutes, which breaks\nthe very premise that \"45 minutes applies once 6 hours is exceeded\".\nIn such cases KIZAMI **deducts only down to the point where the threshold is exactly met**\n(actual working hours are never cut below the threshold). In the 6 hours 5 minutes example, only 5 minutes\nare subtracted, leaving exactly 6 hours, and nothing more is cut.\n\nNote that when the result after subtraction lands exactly on the threshold, the full amount is deducted as\nusual. Being present for 9 hours from 9:00 to 18:00 and subtracting 60 minutes leaves exactly 8 hours, but\nthat is precisely the most common way of working — \"8 hours of work plus a 60-minute lunch break\" — so it is\nrecorded that way.\n\n## Relationship to the principles of simultaneous granting and free use\n\nIn addition to the rule on the quantity (number of hours) of rest periods (Article 34(1)), there is the\n**principle of granting rest periods simultaneously** (Article 34(2); exceptions are possible by\nlabor-management agreement) and the **principle of free use of rest periods** (Article 34(3)). What KIZAMI\ndetects and deducts automatically is only the number of hours that can be determined mechanically from punch\ndata; whether rest periods were granted simultaneously or could be used freely is outside what it detects.",
      companyExample: "This company has automatic deduction of rest periods enabled (45 minutes over 6 hours, 60 minutes over 8 hours).\nOn a day when work made it impossible to take a rest period, submit a cancellation request and report it to your supervisor the same day.",
    },
    "attendance.day-boundary": {
      key: "attendance.day-boundary",
      audience: ["employee","admin"],
      origin: "product",
      summary: "The day boundary is the setting for when \"one day\" starts. For work that crosses dates, such as late-night work, the day boundary decides which attendance date the work belongs to.",
      body: "# Day boundary (the start-of-day cutoff)\n\nThe day boundary is the cutoff time that determines when \"one day\" starts and ends for attendance purposes.\nMost tenants set the day boundary at midnight, but a workplace with a lot of late-night work can set it to\nanother time, such as 5:00 a.m.\n\n## Effect on work that crosses dates\n\nPunches before the day boundary are treated as the previous day's work, and punches at or after the day\nboundary as the current day's work. For example, with the day boundary set to 5:00 a.m., starting work at\n1:00 a.m. and clocking out at 6:00 a.m. means the clock-in and clock-out are both counted as attendance for\nthe same \"work start date\" (it is not split even though it crosses the 5:00 a.m. day boundary).\n\nThe day boundary setting affects every aggregation that is done on a daily basis, including monthly totals,\nthe flex balance, and Article 36 agreement alerts. Changing the setting changes how attendance dates are\nassigned from then on.",
      companyExample: "Our day boundary is 5:00 a.m. (because some departments have a lot of late-night work).\nWork that ends before 5:00 a.m. is counted as the previous day's work.",
    },
    "attendance.fixed-overtime": {
      key: "attendance.fixed-overtime",
      audience: ["employee","admin"],
      origin: "law",
      basis: "Article 32(1) and (2) and Article 37(1) (premium wages) of the Labor Standards Act; 昭和63年基発第1号 (Notification Kihatsu No. 1 of 1988) on the start of the week",
      summary: "Under a fixed working hours system, statutory overtime work is determined first for the hours beyond 8 in a day, then by adding the non-statutory hours in that week that exceed 40 hours per week. Calculating in any other order counts the same work twice.",
      body: "# How overtime is counted under a fixed working hours system\n\nStatutory overtime work is judged on both a **daily** and a **weekly** basis (Article 32 of the Labor\nStandards Act).\n\n## Order of the judgment\n\n1. **Daily judgment** — the actual working hours of that day minus 8 hours is that day's statutory overtime work\n2. **Weekly judgment** — the hours that did not become overtime in step 1 (work within statutory working hours)\n   are accumulated from the start of the week, and the hours exceeding 40 are added to statutory overtime work\n\n**This order matters.** Judging by the week first would put work that has already been counted as overtime for\nexceeding 8 hours in a day into the weekly total as well, counting the same work twice.\n\n### Example: working 6 days a week, 7 hours a day\n\nEach day is within 8 hours, so the daily judgment in step 1 produces no overtime.\nThe weekly total, however, is 42 hours, so the **2 hours** in excess of 40 hours are weekly statutory overtime work.\n\n### Example: working 5 days a week, with 10 hours on just one of them\n\nThe 10-hour day produces **2 hours** of daily statutory overtime.\nThe remaining work within statutory working hours for the week is 8 hours × 4 days + 8 hours = exactly 40 hours,\nso nothing is added on the weekly judgment. The total is 2 hours.\n\n## The day the week starts\n\nJudging the 40-hour week requires a week boundary. Where the rules of employment do not provide for one,\na week **starting on Sunday** is the rule (昭和63年基発第1号, Notification Kihatsu No. 1 of 1988).\nIn KIZAMI this can be set per company.\n\n## The 8-hour day does not change at a 特例措置対象事業場\n\nFor workplaces in commerce, the film and theater industry, health and hygiene services, or the hospitality\nand entertainment industry that regularly employ fewer than 10 workers\n(特例措置対象事業場, a workplace covered by the special measure), the statutory weekly working hours are\nrelaxed to 44 hours (Article 40 of the Labor Standards Act and Article 25-2 of the Ordinance for Enforcement\nof the Labor Standards Act). **Only the week is relaxed; the 8 hours per day do not move.**\n\n## Weeks that span two months (KIZAMI behavior)\n\nFor a week that spans two months, KIZAMI judges the 40-hour week using **only the days that fall within that\nmonth's period**. Hours from the previous month are not carried over.\n\nThis behavior gives priority to keeping the figures of a closed month from moving afterwards. As a result,\nweekly statutory overtime work can come out lower than it actually was in the first week of a month. Where\nlong working hours span the start of a month, check the daily actual working hours in the monthly list as well.",
      companyExample: "Overtime work requires an application in advance. Perform it only after obtaining your supervisor's approval.\nOur week starts on Sunday (Article X of the rules of employment).",
    },
    "attendance.flex-frame": {
      key: "attendance.flex-frame",
      audience: ["employee","admin"],
      origin: "law",
      basis: "Article 32 and Article 32-3 of the Labor Standards Act (settlement period of the flexible working hours system)",
      summary: "The monthly total working hours limit (総枠) is \"statutory weekly working hours × calendar days in that month ÷ 7\". Hours actually worked in excess of this limit are overtime work.",
      body: "# The total hours limit under a flexible working hours system\n\nUnder a flexible working hours system, working hours are judged not day by day but on the **total for the\nsettlement period (one month with this setting)**. The upper limit of hours to be worked in that period is\ncalled the total working hours limit (総枠).\n\n```\nTotal hours limit = statutory weekly working hours × calendar days in that month ÷ 7\n```\n\nStatutory weekly working hours are 40 hours as a rule. By way of exception they are 44 hours for workplaces\nin commerce, the film and theater industry, health and hygiene services, or the hospitality and entertainment\nindustry that regularly employ fewer than 10 workers\n([特例措置対象事業場](./tenant-special-provision) — a workplace covered by the special measure).\n\n| Days in the month | At 40 hours per week | At 44 hours per week |\n| --- | --- | --- |\n| 30 days | 171 hours 25 minutes | 188 hours 34 minutes |\n| 31 days | 177 hours 8 minutes | 194 hours 51 minutes |\n\nHours actually worked in excess of the total hours limit are **overtime work**, and hours below it are a\n**shortfall**. They are shown as the \"Flex balance\" on the KIZAMI monthly screen.\n\n## How days of paid leave are treated\n\nA day on which annual paid leave is taken counts toward the actual hours as if it had been worked (the\nprescribed working hours for a full day, half of that for a half day, and the corresponding hours for hourly\nunits). Taking paid leave never increases the shortfall.",
    },
    "attendance.late-night": {
      key: "attendance.late-night",
      audience: ["employee","admin"],
      origin: "law",
      basis: "Article 37(4) of the Labor Standards Act",
      summary: "Work between 22:00 and 5:00 the next morning is late-night work and is subject to premium wages of 25% or more. Where it overlaps with overtime work, the premium rates are added together.",
      body: "# The premium for late-night work (22:00 to 5:00 the next morning)\n\nHours worked between **10:00 p.m. and 5:00 a.m. the next morning** are treated as late-night work and are\nsubject to premium wages of **25% or more** on top of ordinary wages (Article 37(4) of the Labor Standards Act).\n\n## Overlapping premiums are added together\n\nLate-night work can occur at the same time as overtime work or work on holidays. In that case the premium\nrates are **added together**.\n\n| Combination | Approximate premium rate |\n| --- | --- |\n| Late-night work only | 25% or more |\n| Overtime work + late-night work | 50% or more (25% + 25%) |\n| Work on a statutory holiday + late-night work | 60% or more (35% + 25%) |\n\n## What KIZAMI covers\n\nKIZAMI goes as far as classifying and totaling the hours that fall in the late-night band (22:00 to 5:00 the\nnext morning) from the punches. Calculating and paying the actual premium wages is done on the payroll side,\nbased on those totals.",
    },
    "attendance.legal-holiday": {
      key: "attendance.legal-holiday",
      audience: ["employee","admin"],
      origin: "law",
      basis: "Article 35 and Article 37(1) of the Labor Standards Act",
      summary: "A statutory holiday is at least one day off per week (or four days in every four weeks). It is a different concept from the company-designated holidays a company sets, and only work on a statutory holiday is subject to the premium of 35% or more for work on holidays.",
      body: "# The difference between statutory holidays and company-designated holidays\n\nA **statutory holiday** is the minimum day off that Article 35 of the Labor Standards Act obliges the employer\nto provide: either **at least one day per week** or **at least four days in every four weeks** must be given.\n\nA **company-designated holiday (a non-statutory holiday)** is any other day off that the company sets in its\nrules of employment or elsewhere (for instance one of the two days of a \"Saturday and Sunday off\" schedule).\nIt is something the company provides voluntarily beyond the legal minimum, and KIZAMI treats the two as\ndistinct.\n\n## Premium wages apply only to work on a statutory holiday\n\n| Type of holiday | If you work on that day |\n| --- | --- |\n| Statutory holiday | Work on holidays, with a premium of **35% or more** (Article 37(1) of the Labor Standards Act) |\n| Company-designated holiday (other than a statutory holiday) | No premium for work on holidays. However, if working hours that week exceed 40 hours per week, it is overtime work with a premium of 25% or more |\n\nIt is often assumed that \"working on a day off always means a 35% premium\", but the 35% premium arises only\nwhere the work is done on a statutory holiday. Work on a company-designated holiday is treated as overtime\nwork, not as work on a statutory holiday.",
    },
    "attendance.minute-unit": {
      key: "attendance.minute-unit",
      audience: ["employee","admin"],
      origin: "law",
      basis: "Article 24 and Article 37 of the Labor Standards Act; 昭63.3.14基発150号 (Notification Kihatsu No. 150 of March 14, 1988)",
      summary: "As a rule, working hours are to be tracked day by day in units of one minute. Rounding down to the worker's disadvantage may be held to violate full payment of wages (Article 24 of the Labor Standards Act) and premium wages (Article 37 of the Labor Standards Act).",
      body: "# Rounding of working hours (units of one minute)\n\nAs a rule, working hours are calculated from the daily record in **units of one minute**. Treatments that\nround the hours down to less than what was actually worked and thereby reduce wages, such as \"discard\nanything under 15 minutes\" or \"discard anything under 30 minutes\", may be held to violate Article 24 of the\nLabor Standards Act (full payment of wages) or Article 37 (payment of premium wages).\n\n## The only exception: rounding the monthly total\n\nThe daily working hours themselves cannot be rounded, but where a fraction of less than one hour arises in the\n**monthly total of overtime work, work on holidays and late-night work**, and only there, it is permitted to\nround down fractions of less than 30 minutes and round up fractions of 30 minutes or more\n(昭63.3.14基発150号, Notification Kihatsu No. 150 of March 14, 1988).\n\n| Subject | Rounding |\n| --- | --- |\n| Daily working hours | Cannot be rounded down (calculated in units of one minute) |\n| Monthly total of overtime work and the like | Fractions under 30 minutes may be rounded down and 30 minutes or more rounded up |\n\nIt is often assumed that \"daily punches may be rounded\", but what is permitted applies only to the monthly total.",
    },
    "attendance.warnings": {
      key: "attendance.warnings",
      audience: ["employee","admin"],
      origin: "product",
      summary: "When punches are incomplete, KIZAMI interprets the missing or contradictory parts conservatively. Intervals with no matching punch are left out of the totals, and punches that do not add up are invalidated.",
      body: "# How incomplete punches are handled\n\nA forgotten punch or a mistaken action can leave clock-in, clock-out or rest period punches incomplete.\nKIZAMI **interprets such cases conservatively**.\n\n## Why the interpretation is conservative\n\nWorking hours have to record \"the hours actually worked\" correctly. Filling in an interval with a missing\npunch by guesswork and counting it as working hours risks recording more (or less) working time than there\nactually was. So that intervals it cannot confirm are never fabricated as working hours, KIZAMI follows the\npolicy of **leaving missing information out of the totals**. Where this differs from the actual working hours,\nsupply the correct punches with a correction request.\n\n## Main patterns\n\n| Situation | How KIZAMI handles it |\n| --- | --- |\n| No clock-out punch | That work interval is excluded from the totals (not counted as hours worked) |\n| A duplicate clock-in punch while already working | The later duplicate clock-in punch is invalidated |\n| A clock-out punch while not clocked in | That clock-out punch is invalidated |\n| A rest period punch outside of work | That rest period punch is invalidated |\n| A duplicate rest period start punch while already on a rest period | The later duplicate rest period start punch is invalidated |\n| A rest period end punch with no matching rest period start | That rest period end punch is invalidated |\n| A clock-out punch during a rest period | Treated as having ended the rest period and clocked out |\n\nThese are shown in the warnings column of the monthly screen. Where they differ from the actual working\nhours, use \"Correct\" for that day to request the correct punches.",
    },
    "attendance.work-system": {
      key: "attendance.work-system",
      audience: ["employee","admin"],
      origin: "law",
      basis: "Article 32 (working hours) and Article 32-3 (flexible working hours system) of the Labor Standards Act",
      summary: "The working hours system changes what \"overtime work\" means. Under a fixed working hours system it is the hours beyond 8 per day and 40 per week; under a flexible working hours system it is the hours beyond the total hours limit for the settlement period (one month).",
      body: "# Working hours systems and what \"overtime\" means\n\nEven for the same \"worked 10 hours in a day\", whether it becomes overtime work depends on the working hours\nsystem that applies.\n\n## Fixed working hours system\n\nThere are upper limits of **8 hours per day and 40 hours per week**, and hours beyond them become overtime\nwork on the spot (Article 32 of the Labor Standards Act). This is settled that same day, without waiting for\nthe end of the month.\n\nIf you work 7 hours 30 minutes at a company whose prescribed working hours are 7 hours, those 30 minutes\nexceed the prescribed hours but are within 8 hours per day, so they are **not statutory overtime work**.\nNo premium wages are required, but the wages for the hours worked are of course payable. KIZAMI shows this\nseparately as \"non-statutory overtime\".\n\n## Flexible working hours system\n\nThe actual hours are compared with the **total hours limit** for the settlement period (one month in KIZAMI),\nand the hours in excess become overtime work (Article 32-3 of the Labor Standards Act). The total hours limit\nis \"statutory weekly working hours × calendar days in that month ÷ 7\".\n\n**There is no concept of overtime work on a per-day basis.** Even if you work 10 hours on a given day, it is\nnot overtime work as long as it stays within the month's total hours limit. Being able to decide your own\nstart and finish times is the point of this system, so it is designed without daily upper limits.\n\nFor this reason, the monthly list for someone under a flexible working hours system **does not show an\novertime column**. It is not that it is being hidden; it is that nothing has been determined yet for that day.\nThe projection partway through the month can be checked with the \"Flex balance\".\n\n## What does not change either way\n\nThe following are treated the same regardless of the working hours system.\n\n| | Content |\n| --- | --- |\n| Late-night work | Work between 22:00 and 5:00 the next morning. Premium of 25% or more (Article 37(4) of the Labor Standards Act) |\n| Work on a statutory holiday | Work on the one statutory holiday per week. Premium of 35% or more (Article 37(1) of the Labor Standards Act) |\n| Rest periods | 45 minutes over 6 hours, 60 minutes over 8 hours (Article 34 of the Labor Standards Act) |\n| Annual paid leave | Number of days granted and the obligation to take 5 days per year (Article 39 of the Labor Standards Act) |",
      companyExample: "As a rule this company applies a flexible working hours system (settlement period of one month, no core time).\nThe system that applies to you is stated in your employment contract. If you are unsure which one applies, contact the HR department.",
    },
    "closing.amend": {
      key: "closing.amend",
      audience: ["admin"],
      origin: "product",
      summary: "A post-closing amendment applies a single approved change without unlocking the month's closing. Even after it is applied, the difference from the figures as of the original closing stays visible.",
      body: "# Post-closing amendment\n\nWhen a correction request or a leave request for an already closed month is approved, **just that one change**\ncan be applied and the affected user's totals recalculated without unlocking the closing for the whole month.\nThe month stays closed.\n\n## The difference from the original figures remains\n\nApplying a post-closing amendment puts the month into the \"amended after closing\" state. Both the original\nfigures as of the closing and the current figures after the amendment are retained, and the monthly screen\nkeeps showing the **difference from the original figures**. Which categories changed and by how much can be\ntraced afterwards.\n\n## How this differs from unlocking a closing\n\n| Operation | Scope of the effect | State of the month |\n| --- | --- | --- |\n| Unlocking a closing | Makes the whole month freely editable | Returns to unconfirmed |\n| Post-closing amendment | Applies only the one approved change | Stays confirmed (the difference is recorded) |\n\nBecause it avoids reopening the month, a post-closing amendment suits changes with a small scope. Where the\nwhole month needs to be reviewed, unlock the closing instead.",
    },
    "closing.execute": {
      key: "closing.execute",
      audience: ["employee","admin"],
      origin: "product",
      summary: "Performing a monthly closing confirms that month's attendance records, and any punch or correction afterwards requires a request and approval. The figures as of the moment of confirmation are fixed as a snapshot.",
      body: "# Monthly closing\n\nA closing is the operation that \"confirms\" the attendance records for the target month. The figures as of the\nmoment of closing, such as the totals by category and the flex balance, are fixed as a **snapshot** and do not\nchange retroactively afterwards, even if punches or the method of aggregation change.\n\n## What happens after closing\n\n- After closing, punches can no longer be added, corrected or cancelled; changing them requires **a correction request and its approval**\n- Unlocking the closing (releasing the confirmation) returns the month to a freely editable state. Unlocking requires a separate permission\n- Every closing, unlocking and post-closing amendment is recorded in the audit log\n\nBecause a closing is the starting point for downstream processing such as payroll, it exists to keep the\nfigures of a closed month from changing unintentionally.",
      companyExample: "The previous month is closed on the 5th of each month. Complete your correction requests before then.\nIf a correction is needed after the closing, contact the HR department through your supervisor.",
    },
    "closing.unlock": {
      key: "closing.unlock",
      audience: ["admin"],
      origin: "product",
      summary: "Reopens a finalized monthly closing so attendance records for that month can be corrected again. Unlocking, corrections, and re-closing are all recorded in the audit log.",
      body: "# Unlocking a closing\n\nUnlocking a monthly closing makes the finalized attendance records for that month editable again.\n\n- Requires the \"Unlock closing\" permission\n- If the month has already been exported for payroll, make sure the export destination stays consistent\n- Who unlocked it and when is kept in the closing history and visible in the audit log",
    },
    "correction.flow": {
      key: "correction.flow",
      audience: ["employee","admin"],
      origin: "product",
      summary: "Time punches cannot be edited directly. Additions, amendments, and cancellations are all submitted as correction requests, and they are reflected in attendance records only after approval. Every change, including approvals, rejections, and withdrawals, is recorded in the audit log.",
      body: "# How time punch correction requests work\n\nThe time punch records themselves cannot be rewritten directly. To add, amend, or cancel a time\npunch, you submit a **correction request**, and the change reaches the attendance records only as\nthe result of an approval.\n\n## Types of request\n\n- **Addition**: a request to newly register a clock-in, clock-out, or rest period that was not punched\n- **Amendment**: a request to change the time or type of an existing time punch\n- **Cancellation**: a request to treat an existing time punch as never having been made\n\n## Flow up to approval\n\n1. The person concerned (or a member with delegate permission) submits the request with a reason (status: Pending)\n2. A member with approval permission reviews the content and approves or rejects it\n3. Once approved, the change is applied to the time punch and reflected in the monthly totals. A rejected request is not applied\n4. While the request is pending, the person concerned can also withdraw it\n\nIf the month concerned has already been closed, a separate permission to unlock the closing is\nrequired in order to approve the request.\n\n## Everything is kept in the audit log\n\nSubmission, approval, rejection, and withdrawal of a request are all recorded in the audit log,\nincluding when and by whom. When the approver and the requester are the same person\n(self-approval), that fact is also kept as a record.",
      companyExample: "Submit requests by the end of the business day following the day concerned.\nDuring busy periods (the last three business days of the month), approval may be delayed until the next business day.",
    },
    "law.versioning": {
      key: "law.versioning",
      audience: ["admin"],
      origin: "product",
      summary: "Statutory amendments switch over automatically once the enforcement date registered in advance arrives. Calculations for past periods stay on the law that was in force during that period.",
      body: "# Automatic switchover for statutory amendments\n\nKIZAMI manages statutory rules such as the Labor Standards Act as \"versions with an enforcement\ndate\". If you register a future amendment in advance, before it takes effect, the rules switch over\nto the new ones automatically the moment the enforcement date arrives, and the amendment is shown\nin advance on the tenant profile screen as an upcoming change.\n\n## Past periods keep the rules of their time\n\nAn amendment applies only to periods on or after its enforcement date. Not only for months that\nhave already been closed, but also for past months that have not been closed, the statutory rules\nused for aggregation are **the ones that were in force during that period**. Past periods are never\nrecalculated retroactively under the latest rules.\n\nThis prevents past aggregation results from changing every time the law is amended (and diverging\nfrom figures that have already been closed).",
    },
    "leave.grant": {
      key: "leave.grant",
      audience: ["employee","admin"],
      origin: "law",
      basis: "Article 39(1) and (2) and Article 115 of the Labor Standards Act",
      summary: "Annual paid leave is granted at 10 days once a worker has been continuously employed for six months from hiring and has reported for work on at least 80% of all working days, and it then increases with years of service up to a maximum of 20 days. Leave that has been granted expires by prescription two years after the grant date.",
      body: "# Statutory grant days and expiry of annual paid leave\n\nA worker who has been **continuously employed for six months** from the day of hiring and has\n**reported for work on at least 80%** of all working days during that period is granted annual paid\nleave (Article 39(1) of the Labor Standards Act). After that, the number of days increases with\nyears of service (paragraph (2) of the same Article).\n\n## Days granted by years of service (full-time)\n\n| Years of service | Days granted |\n| --- | --- |\n| 6 months | 10 days |\n| 1 year 6 months | 11 days |\n| 2 years 6 months | 12 days |\n| 3 years 6 months | 14 days |\n| 4 years 6 months | 16 days |\n| 5 years 6 months | 18 days |\n| 6 years 6 months and beyond | 20 days |\n\nIn every band, the condition is that the worker reported for work on at least 80% of all working\ndays in the period concerned.\n\n## When the number of prescribed working days per week is small (proportional grant)\n\nWorkers whose prescribed working hours are under 30 per week AND whose prescribed working days are\n4 or fewer per week (or, where the period is other than a week, 216 or fewer prescribed working days\nper year) are covered by a separate table of **proportional grant** days rather than the table above\n(Article 39(3) of the Labor Standards Act, Article 24-3 of its Enforcement Regulations).\n\n| Days per week | 6 months | 1 yr 6 mo | 2 yr 6 mo | 3 yr 6 mo | 4 yr 6 mo | 5 yr 6 mo | 6 yr 6 mo and beyond |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| 4 days | 7 | 8 | 9 | 10 | 12 | 13 | 15 |\n| 3 days | 5 | 6 | 6 | 8 | 9 | 10 | 11 |\n| 2 days | 3 | 4 | 4 | 5 | 6 | 6 | 7 |\n| 1 day | 1 | 2 | 2 | 2 | 3 | 3 | 3 |\n\nKIZAMI computes the days from this table according to each member's \"annual leave grant class\".\nThe class is **not** derived automatically from weekly hours or days: an administrator sets it based\non the rules of employment and the employment contract (member management screen). Members with no\nclass set are treated as standard (5 or more days per week).\n\nNote that even a proportional grant is **subject to the 5-day mandatory taking obligation once a\nsingle grant reaches 10 days or more** (for example, 3 years 6 months in the 4-days-a-week class).\n\n## Expiry is two years\n\nAnnual paid leave that has been granted expires by prescription **two years after the grant date**\n(Article 115 of the Labor Standards Act). Only leave within those two years carries over from the\nprevious year to the current year as unused leave.",
      companyExample: "As a treatment more favorable than the statutory minimum, our company grants 5 days early, on the date of hire.\nFor details, see Article ◯ of the rules of employment.",
    },
    "leave.hourly": {
      key: "leave.hourly",
      audience: ["employee","admin"],
      origin: "law",
      basis: "Article 39(4) of the Labor Standards Act; 平21.5.29基発0529001号 (Notification Kihatsu No. 0529001 of May 29, 2009)",
      summary: "Annual paid leave can be taken in hourly units only where a labor-management agreement exists, and only up to the equivalent of five days per year. The number of hours per day is calculated by rounding the prescribed working hours up to a whole hour.",
      body: "# Annual paid leave in hourly units\n\nAnnual paid leave is in principle taken in units of one day, but **only where a labor-management\nagreement has been concluded** may it be taken in hourly units.\n\n## The cap is the equivalent of five days per year\n\nLeave may be taken in hourly units **only up to the equivalent of five days per year**. This is the\nstatutory ceiling: a labor-management agreement may set a lower figure, but it cannot exceed this.\n\nThe number of hours making up \"five days\" is calculated by **rounding the prescribed working hours\nof one day up to a whole hour**.\n\n| Prescribed working hours | Per day | Five days per year |\n| --- | --- | --- |\n| 8 hours | 8 hours | 40 hours |\n| 7 hours 30 minutes | **8 hours** (rounded up) | 40 hours |\n| 7 hours | 7 hours | 35 hours |\n\nAnnual paid leave carried over from the previous year and taken in hourly units is also counted\n**within the current year's allowance of five days**. Carried-over leave does not get a separate\nallowance.\n\n## It does not count toward the obligation to take five days\n\nLeave taken in hourly units is not accepted as leave taken for the purpose of meeting the\n[obligation to take five days per year](./leave-mandatory-five-days). To meet that obligation, the\nleave has to be taken as a full day or a half day.",
      companyExample: "Our company allows leave to be taken in units of one hour (under a labor-management agreement).\nIf you want to take more than half a day, use a half-day leave instead.",
    },
    "leave.mandatory-five-days": {
      key: "leave.mandatory-five-days",
      audience: ["employee","admin"],
      origin: "law",
      basis: "Article 39(7) and (8) of the Labor Standards Act (in force from April 1, 2019)",
      summary: "A person granted 10 or more days of annual paid leave in a year has to take 5 days within one year of the grant date. A half day counts as 0.5 days, but leave taken in hourly units does not count.",
      body: "# The obligation to take five days per year\n\nA person granted 10 or more days of annual paid leave in a year has to take **5 days within one\nyear of the grant date**. This is both a right of the worker and an obligation imposed on the\ncompany.\n\n## Watch how it is counted\n\n| Unit of leave | Does it count toward the 5 days? |\n| --- | --- |\n| Full day | Counts as 1.0 day |\n| Half day (morning or afternoon) | **Counts as 0.5 days** |\n| Hourly units | **Does not count** |\n\nAnnual paid leave taken in hourly units is not accepted as leave taken for the purpose of meeting\nthis obligation of five days. Even if 40 hours are taken in hourly units, the obligation remains\nfulfilled to the extent of 0 days. To meet the obligation, the leave has to be taken as a full day\nor a half day.\n\n## The deadline\n\nThe deadline is \"one year after the grant date\". Grant dates differ from person to person (where\nthey are based on the date of hire), so deadlines differ as well. You can check your own deadline\nand remaining days on the annual paid leave screen in KIZAMI.\n\nNotifications are sent as the deadline approaches (90 days before and 30 days before).",
      companyExample: "Tell your department head by the end of April each year when you plan to take your leave.\nHR contacts individually in October anyone who still has 3 or more days unused.",
    },
    "overtime.60h": {
      key: "overtime.60h",
      audience: ["employee","admin"],
      origin: "law",
      basis: "Proviso to Article 37(1) of the Labor Standards Act (in force from April 1, 2010; applied to small and medium-sized enterprises from April 1, 2023)",
      summary: "For overtime work exceeding 60 hours in a month, the premium wage rate for the excess portion is 50% or more. Small and medium-sized enterprises had a grace period, but the rule has applied to all companies since April 1, 2023.",
      body: "# Premium rate for overtime work exceeding 60 hours a month\n\nWhere overtime work in one month **exceeds 60 hours**, the premium wage rate for **the portion\nexceeding** that figure becomes **50% or more** (proviso to Article 37(1) of the Labor Standards\nAct).\n\n## The portion up to 60 hours is unchanged\n\nOnly the portion exceeding 60 hours goes to 50%; the portion up to 60 hours stays at the ordinary\npremium rate for overtime work (25% or more). It is not a case of \"everything becomes 50% once the\nmonth passes 60 hours\".\n\n| Category of overtime work | Premium rate |\n| --- | --- |\n| Up to 60 hours | 25% or more |\n| Portion exceeding 60 hours | 50% or more |\n\n## The grace period for small and medium-sized enterprises has ended\n\nThis 50% rule applied to large companies from April 1, 2010, but small and medium-sized enterprises\nhad a grace measure. Since **April 1, 2023** it applies to small and medium-sized enterprises as\nwell, so the same rule now applies regardless of company size.",
    },
    "permission.presets": {
      key: "permission.presets",
      audience: ["admin"],
      origin: "product",
      summary: "Permission presets are added together when several are assigned, and operational permissions such as approval and execution automatically include the corresponding view permissions. There is no deny rule that cancels out a specific permission.",
      body: "# How permission presets work\n\nA permission preset is a unit of assignment, defined by combining permissions that are on or off\nwith the range they apply to (the scope).\n\n## Multiple assignments are added together\n\nWhen several presets are assigned to one member, the permissions they hold are **added together**.\nWhere different scopes are assigned for the same permission, the broader scope takes effect.\n\n## Operations imply viewing\n\nWhen you turn on an operational permission such as approval, execution, or administration, the view\npermissions needed for that operation within its range are enabled automatically. For example, if\nyou turn on \"Approve time punch correction requests\", the member can also view correction requests\nand attendance records within the range concerned, without those being turned on separately.\n\n## There is no deny rule\n\nThe KIZAMI permission model has no \"deny\" rule that explicitly cancels out a specific permission.\nSo that assigning several presets does not end up granting broader permissions than intended, check\nthe list of permissions each preset actually turns on when you assign them.",
    },
    "privacy.internal-terms-template": {
      key: "privacy.internal-terms-template",
      audience: ["employee","admin"],
      origin: "product",
      summary: "A template for internal terms of use covering time punches, such as the duty to punch accurately and the ban on punching on someone else's behalf, is available from the \"Settings > Personal information\" screen.",
      body: "# Template for internal terms of use on time punches\n\nA template for internal terms of use is available from the \"Settings > Personal information\"\nscreen, covering the duty to punch accurately, the ban on punching on someone else's behalf, the\nprocedure for a correction request when a punch has been missed, and the handling of fraudulent\npunches.\n\nUse the template to suit how your own company operates, whether by making it part of the rules of\nemployment as it stands or by publicizing it to employees as a separate document. If you have set a\nlink to your rules of employment, a pointer to them is appended automatically at the end of the\ntemplate.",
      companyExample: "These terms are treated as part of Article ◯ (service discipline) of the rules of employment. Breaches are handled under the disciplinary provisions of the rules of employment.",
    },
    "privacy.notice-template": {
      key: "privacy.notice-template",
      audience: ["employee","admin"],
      origin: "product",
      summary: "A template for the privacy notice announced to employees regarding personal information such as time punches, IP addresses, user agents, and GPS coordinates is available from the \"Settings > Personal information\" screen. It is generated automatically from the current GPS setting and retention period.",
      body: "# Template for the privacy notice to employees\n\nTime punch records, IP addresses, user agents, and GPS coordinates (where enabled) are personal\ninformation of employees. The obligation to announce to employees the purpose of acquiring this\ninformation and how long it is retained (Articles 17, 18, and 21 of the Act on the Protection of\nPersonal Information) rests with **the company that deploys the product**, not with the KIZAMI\nproject.\n\nFrom the \"Settings > Personal information\" screen, KIZAMI automatically generates a privacy notice\ntemplate that reflects the current tenant settings (whether GPS is enabled or disabled, and the\nretention period). If GPS is disabled, the items relating to location information are not shown.\n\n## How to use it\n\n1. Review the text generated on the \"Settings > Personal information\" screen\n2. Revise it to match your own circumstances (such as the contact point for requests for disclosure or correction)\n3. Publicize it to employees (by posting it, publishing it on the intranet, attaching it to employment contracts, or another method of your choosing)\n\nThe generated text is only a template and is not legal advice. If you have any doubts about its\ncontent, check with an expert such as a certified social insurance and labor consultant or a lawyer.",
      companyExample: "In August 2026 our company drew up a privacy notice based on this template and posted it under \"Announcements\" on the intranet.\nIf you revise it, add the posting date here.",
    },
    "privacy.retention-after-leaving": {
      key: "privacy.retention-after-leaving",
      audience: ["employee","admin"],
      origin: "law",
      basis: "Article 109 of the Labor Standards Act and Article 143(2) of its supplementary provisions; Article 22 of the Act on the Protection of Personal Information",
      summary: "Attendance records are required by law to be retained even after an employee leaves (five years in principle, three years for the time being under a transitional measure). Once that period has passed, information that identifies the individual, such as the name and email address, is removed, but the attendance records themselves remain.",
      body: "# Retention and erasure of records after leaving\n\nLeaving the company does not mean that the attendance records disappear straight away. This is\nbecause **the law requires them to be retained**.\n\n## Two laws point in opposite directions\n\n| Law | What it requires |\n| --- | --- |\n| Article 109 of the Labor Standards Act | Records such as the wage ledger and the attendance record book **must be retained** (five years in principle; three years for the time being under the transitional measure in Article 143(2) of the supplementary provisions) |\n| Article 22 of the Act on the Protection of Personal Information | Where personal data no longer needs to be used, the operator **must endeavor to erase it without delay** |\n\nFor a person who has left, these two collide head-on: erasing the records goes against the Labor\nStandards Act, while keeping them goes against the duty to endeavor under the Act on the Protection\nof Personal Information.\n\nSince the duty to retain is a \"must\" (a mandatory duty) while erasure is a \"must endeavor to\"\n(a duty to endeavor), the correct order is to **keep the records until the retention period has run\nout**.\n\n## When the retention period starts to run\n\nThe retention period under Article 109 of the Labor Standards Act is counted from \"the date of the\nlast entry\". For a person who has left, the last attendance record is that date. KIZAMI treats **the\ndate on which the leaving process was carried out** as the starting date. Because the leaving\nprocess takes place on or after the last day worked, this treatment can only fall **later** than the\nactual starting date, never earlier, and so it never cuts into the statutory period.\n\n## What happens once the period has passed\n\nOnce the retention period has passed, an administrator becomes able to erase the personal data of\nthe person who has left. What disappears and what remains is as follows.\n\n| Item | Treatment |\n| --- | --- |\n| Name and email address | Replaced with a form that does not identify the individual |\n| Password, two-factor authentication, and login information | Deleted |\n| Notification settings and device information (IP address, browser information, location information) | Deleted |\n| Attendance records (punch times, aggregated results, figures for closed months) | **Kept** (because of the retention duty) |\n| Audit log | **Kept** (not altered; only the name shown in it is anonymized) |\n\nIn other words, this is not \"erasing the records\" but **removing from the records the information\nabout whose records they are**. Because the attendance record rows themselves are not deleted, the\naggregated figures for months that have already been closed are the same before and after the\nerasure.\n\nThis operation **cannot be undone**. If you would like your own records disclosed to you after\nleaving, contact the company's point of contact before the retention period runs out.\n\n## The company chooses the retention period\n\nWhether to adopt three years (the transitional measure) or five years (the principle) is for the\ncompany to decide. The KIZAMI default is **five years** — the transitional measure will end at some\npoint, and a company that has left the setting at three years would no longer meet the retention\nduty at that time.",
      companyExample: "Our company sets the retention period at three years (the transitional measure).\nIf you would like your own records disclosed to you after leaving, contact the HR department within that period.",
    },
    "tenant.special-provision": {
      key: "tenant.special-provision",
      audience: ["admin"],
      origin: "law",
      basis: "Article 40 of the Labor Standards Act; Article 25-2 of the Ordinance for Enforcement of the Labor Standards Act",
      summary: "Workplaces in commerce, the motion picture and theater business, the health and hygiene business, or the amusement and entertainment business that regularly employ fewer than 10 workers have statutory working hours of 44 hours per week. This is a current system, not a transitional measure from the past.",
      body: "# 特例措置対象事業場 (workplace covered by the special measure — 44-hour week)\n\nStatutory working hours are 40 hours per week in principle, but a workplace that meets **both** of\nthe following conditions has **44 hours**.\n\n1. Its industry is one of **commerce, the motion picture and theater business, the health and hygiene business, or the amusement and entertainment business**\n2. It regularly employs **fewer than 10 workers**\n\nThis was established when the 40-hour week was fully implemented in 1997, and it is **a system that\nis still alive today**, not a transitional measure from the past.\n\n## Effect on aggregation\n\nStatutory working hours per week are used to calculate the\n[total working hours limit under the flexible working hours system](./attendance-flex-frame), so\nwhether or not a workplace qualifies changes the monthly total hours limit.\n\n| Days in the month | 40-hour week | 44-hour week |\n| --- | --- | --- |\n| 30 days | 171 hours 25 minutes | 188 hours 34 minutes |\n| 31 days | 177 hours 8 minutes | 194 hours 51 minutes |\n\nFor a 30-day month the difference is roughly 17 hours. **If a workplace qualifies but the setting\nis not applied, work that is not actually overtime is recorded as overtime.**\n\n## Setting it and reviewing it\n\nYou switch this in \"Settings → Tenant profile\". The determination is made per workplace, so **a\nworkplace stops qualifying as soon as it has 10 or more employees**. Review the setting whenever\nthe headcount changes (KIZAMI does not determine this automatically from the headcount).",
      companyExample: "Our workplace is in retail and has 7 employees, so it qualifies as a 特例措置対象事業場 (as of April 2026).\nIf the number of employees reaches 10 or more, review the setting promptly.",
    },
  },
  ko: {
    "agreement36.limits": {
      key: "agreement36.limits",
      audience: ["employee","admin"],
      origin: "law",
      basis: "노동기준법 제36조 제4항·제5항·제6항(2019년 4월 1일 시행, 중소기업은 2020년 4월 1일 시행)",
      summary: "36협정으로 연장할 수 있는 시간외근로는 원칙적으로 월 45시간·연 360시간까지입니다. 임시적인 특별한 사정이 있는 경우에 한하여 노사협정으로 정하는 특별조항을 통해 연 720시간 등의 상한까지 연장할 수 있으나, 상한에는 횟수와 복수월 평균에 관한 제한도 있습니다.",
      body: "# 36협정의 상한 규제\n\n시간외근로·휴일근로를 시키려면 미리 36협정(36協定, 노동기준법 제36조에 따른 노사협정)을 체결하고 신고해야 합니다.\n그 연장시간에는 벌칙이 따르는 상한이 있습니다(노동기준법 제36조 제4항~제6항).\n\n## 원칙(한도시간)\n\n| 구분 | 상한 |\n| --- | --- |\n| 월 | 45시간 |\n| 연 | 360시간 |\n\n## 특별조항(임시적인 특별한 사정이 있는 경우)\n\n원칙의 상한을 초과하여 근로시킬 필요가 있는 경우, **특별조항이 포함된 36협정을 미리 체결·신고해\n두고 있을 것**을 전제로 다음 상한까지 연장할 수 있습니다. 특별조항이 없으면 이러한 연장은 인정되지 않습니다.\n\n| 구분 | 상한 |\n| --- | --- |\n| 연간 시간외근로 | 720시간 이내 |\n| 단월(휴일근로 포함) | 100시간 미만 |\n| 복수월 평균(2~6개월 평균, 휴일근로 포함) | 80시간 이내 |\n| 월 45시간을 초과할 수 있는 횟수 | 연 6회까지 |\n\n특별조항은 어디까지나 '임시적인 특별한 사정'이 있는 달에 한정하여 사용하기 위한 것이며,\n상시적으로 상한 가득까지 근로시키는 것을 인정하려는 취지가 아닙니다.",
      companyExample: "월 40시간을 초과할 것으로 예상되는 시점에 소속장을 통해 인사부에 상담하시기 바랍니다.\n특별조항의 적용은 인사부가 일원화하여 관리하며, 사전 승인이 필요합니다.",
    },
    "attendance.auto-break": {
      key: "attendance.auto-break",
      audience: ["employee","admin"],
      origin: "product",
      basis: "노동기준법 제34조(휴게)를 전제로 한 KIZAMI의 집계 사양",
      summary: "자동 공제를 활성화하면 휴게 기록이 없어도 소정의 휴게시간이 실근로시간에서 공제됩니다. 실제로 휴게를 쓰지 못한 날은 취소를 신청하면 공제되지 않으며, 그만큼 휴게 부족 경고가 표시됩니다.",
      body: "# 휴게의 자동 공제\n\n회사 설정에 따라서는 휴게를 기록하지 않아도 근무시간에 따른 소정의 휴게가\n실근로시간에서 자동으로 공제됩니다.\n\n## 동작의 종류\n\n| 설정 | 동작 |\n| --- | --- |\n| 기록 방식 | 기록된 휴게만 공제(자동 공제 없음) |\n| 자동 공제 | 기록 여부와 관계없이 근무시간에 따른 소정의 휴게를 공제 |\n| 병용 | 기록된 휴게를 사용하고, 소정 시간에 미치지 못하는 만큼만 추가로 공제 |\n\n기본값은 **기록 방식**(자동 공제 꺼짐)입니다. 자동 공제를 사용할지 여부는 회사 설정에 달려 있으며,\n활성화하는 경우 위 표의 '자동 공제' 또는 '병용'을 선택합니다.\n\n자동 공제된 시간은 월별 목록에서 기록에서 비롯된 휴게와 **구분하여 표시**됩니다.\n'스스로 기록하지 않았는데 휴게가 공제되어 있다'는 점을 알아차릴 수 있어야 하기 때문입니다.\n\n## 실제로 휴게를 쓰지 못했을 때\n\n자동 공제는 '휴게를 썼을 것'이라는 전제로 공제하는 구조입니다.\n**실제로는 쓰지 못한 날에 그대로 공제되면 근로한 시간이 과소하게 기록됩니다.**\n\n그날에 대해 **취소 신청**(자동 공제 취소 신청)을 제출하십시오. 승인되면 다음과 같이 됩니다.\n\n- 그날의 자동 공제가 없어지고, 실근로시간이 기록된 그대로 돌아옵니다\n- 휴게가 법률상 최저 시간(6시간 초과 시 45분, 8시간 초과 시 60분)에 미치지 못하면\n  휴게 부족 경고가 표시됩니다 — 이는 회사가 휴게를 부여할 의무를\n  이행하지 못했음을 나타내는 것이며, 여러분 기록의 오류가 아닙니다\n\n## 도중에 공제 기준을 밑돌 것으로 보이는 경우\n\n근무 6시간 5분인 날에 45분을 공제하면 남는 시간이 5시간 20분이 되어\n'6시간을 초과하면 45분'이라는 전제 자체가 무너져 버립니다.\nKIZAMI는 이러한 경우 **기준에 딱 맞는 지점까지만 공제합니다**\n(실근로가 기준 미만까지 깎이는 일은 없습니다). 6시간 5분의 예에서는\n5분만 공제하여 정확히 6시간이 되고, 그 이상은 깎이지 않습니다.\n\n또한 공제한 후가 정확히 기준에 맞는 경우에는 평소대로 전액 공제됩니다.\n9시부터 18시까지 9시간 있으면서 60분을 공제하면 남는 시간이 정확히 8시간이지만,\n이는 '8시간 근무 + 점심 휴게 60분'이라는 가장 일반적인 근무 형태 그 자체이므로\n그대로 기록됩니다.\n\n## 일제 부여·자유 이용 원칙과의 관계\n\n휴게에는 양(시간 수)에 관한 규제(제34조 제1항) 외에 **일제 부여의 원칙**(제34조 제2항. 노사협정으로 예외 가능)과\n**자유 이용의 원칙**(제34조 제3항)이 있습니다. KIZAMI가 검지·자동 공제하는 것은 근태 기록 데이터로\n기계적으로 판정할 수 있는 시간 수뿐이며, 휴게를 일제히 부여했는지·자유롭게 이용할 수 있었는지는 검지 대상이 아닙니다.",
      companyExample: "당사는 휴게의 자동 공제(6시간 초과 시 45분·8시간 초과 시 60분)를 활성화하고 있습니다.\n업무 사정으로 휴게를 쓰지 못한 날은 당일 중에 취소 신청과 소속장 보고를 부탁드립니다.",
    },
    "attendance.day-boundary": {
      key: "attendance.day-boundary",
      audience: ["employee","admin"],
      origin: "product",
      summary: "일계는 '하루'의 기산 시각 설정입니다. 야간근무처럼 날짜를 넘기는 근무는 일계를 경계로 어느 근태일에 속하는지가 정해집니다.",
      body: "# 일계(하루의 기산 시각)\n\n일계는 근태상의 '하루'가 언제부터 언제까지인지를 정하는 기산 시각입니다. 많은 테넌트는\n오전 0시를 일계로 하지만, 야간근무가 많은 사업장에서는 오전 5시 등 다른 시각으로 설정할 수 있습니다.\n\n## 날짜를 넘기는 근무에 대한 영향\n\n일계보다 이른 시각의 기록은 전날의 근무, 일계 이후의 기록은 당일의 근무로 취급됩니다.\n예를 들어 일계를 오전 5시로 설정한 경우, 새벽 1시부터 근무를 시작해 아침 6시에 퇴근하더라도\n출근·퇴근 모두 동일한 '근무 개시일'의 근태로 집계됩니다(일계인 오전 5시를 넘겼더라도\n분할되지 않습니다).\n\n일계 설정은 월별 집계·플렉스 수지·36협정(36協定) 알림 등 일 단위로 이루어지는 모든 집계에\n영향을 줍니다. 설정을 변경하면 이후 발생하는 근태의 날짜 배분 방식이 달라집니다.",
      companyExample: "당사의 일계는 오전 5시입니다(야간근무가 많은 부서가 있기 때문입니다).\n오전 5시 이전에 종업한 부분은 전날의 근무로 집계됩니다.",
    },
    "attendance.fixed-overtime": {
      key: "attendance.fixed-overtime",
      audience: ["employee","admin"],
      origin: "law",
      basis: "노동기준법 제32조 제1항·제2항, 제37조 제1항(가산임금), 昭和63年基発第1号(1988년 기발 제1호, 주의 기산)",
      summary: "고정 근로시간제의 법정 시간외는 먼저 1일 8시간을 초과한 부분을 확정하고, 그다음 해당 주의 법정 내 근로가 주 40시간을 초과한 부분을 더합니다. 이 순서로 계산하지 않으면 동일한 근로를 이중으로 세게 됩니다.",
      body: "# 고정 근로시간제의 시간외근로 계산 방법\n\n법정 시간외근로는 **1일**과 **1주** 양쪽으로 판정합니다(노동기준법 제32조).\n\n## 판정의 순서\n\n1. **1일 판정** — 그날의 실근로에서 8시간을 뺀 부분이 그날의 법정 시간외근로입니다\n2. **1주 판정** — 1에서 시간외가 되지 않은 부분(법정 내 근로)을 주의 첫날부터 누적하여,\n   40시간을 초과한 부분을 법정 시간외근로에 더합니다\n\n**이 순서가 중요합니다.** 먼저 주 단위로 판정하면 1일 8시간 초과로 이미 시간외로 잡은 근로를\n주 집계에도 포함시켜, 동일한 근로를 두 번 세게 됩니다.\n\n### 예: 주 6일, 1일 7시간 근무한 경우\n\n각 날은 8시간 이내이므로 1의 일별 판정에서는 시간외가 발생하지 않습니다.\n한편 주 합계는 42시간이 되므로, 40시간을 초과한 **2시간**이 주별 법정 시간외근로입니다.\n\n### 예: 주 5일 중 하루만 10시간 근무한 경우\n\n10시간 근무한 날에 **2시간**의 일별 법정 시간외가 발생합니다. 남은 주의 법정 내 근로는\n8시간 × 4일 + 8시간 = 정확히 40시간이므로 주별로는 추가되지 않습니다. 합계 2시간입니다.\n\n## 주의 기산일\n\n주 40시간을 판정하려면 주의 구분이 필요합니다. 취업규칙에 정함이 없는 경우에는\n**일요일 기산**이 원칙으로 되어 있습니다(昭和63年基発第1号 — 1988년 기발 제1호 통달).\nKIZAMI에서는 회사별로 설정할 수 있습니다.\n\n## 特例措置対象事業場(특례조치 대상 사업장, 주 44시간)에서도 1일 8시간은 달라지지 않습니다\n\n상업·영화연극업·보건위생업·접객오락업으로서 상시 10인 미만인 사업장은\n주 법정 근로시간이 44시간으로 완화됩니다(노동기준법 제40조, 노동기준법 시행규칙 제25조의2).\n**완화되는 것은 주뿐이며, 1일 8시간은 움직이지 않습니다.**\n\n## 월을 넘기는 주의 취급(KIZAMI의 사양)\n\nKIZAMI는 월을 넘기는 주에 대해 **해당 월의 기간 내에 있는 날만으로** 주 40시간을 판정합니다.\n전월분은 이월하지 않습니다.\n\n마감한 달의 수치가 나중에 움직이지 않는 것을 우선한 사양입니다. 이 때문에 월초의 주에서는\n주별 법정 시간외가 실제보다 적게 나올 수 있습니다. 월초에 걸친 장시간 근로가 있는 경우에는\n월별 목록의 일별 실근로시간도 함께 확인해 주십시오.",
      companyExample: "시간외근로는 사전 신청제입니다. 소속장의 승인을 얻은 후에 실시해 주십시오.\n당사의 주 기산일은 일요일입니다(취업규칙 제○조).",
    },
    "attendance.flex-frame": {
      key: "attendance.flex-frame",
      audience: ["employee","admin"],
      origin: "law",
      basis: "노동기준법 제32조·제32조의3(플렉스타임제의 정산기간)",
      summary: "월의 총 근로시간 한도는 '주 법정 근로시간 × 해당 월의 역일수 ÷ 7'로 정해집니다. 실적이 이 한도를 초과한 부분이 시간외근로가 됩니다.",
      body: "# 플렉스타임제의 총 근로시간 한도\n\n플렉스타임제(선택적 근로시간제)에서는 하루 단위가 아니라 **정산기간(이 설정에서는 1개월)의 합계**로\n근로시간을 판단합니다. 그 기간에 근로해야 할 시간의 상한을 총 근로시간 한도(総枠)라고 부릅니다.\n\n```\n총 한도 = 주 법정 근로시간 × 해당 월의 역일수 ÷ 7\n```\n\n주 법정 근로시간은 원칙적으로 40시간입니다. 예외로 상업·영화연극업·보건위생업·접객오락업으로서\n상시 10인 미만인 사업장([특례조치 대상 사업장(特例措置対象事業場)](./tenant-special-provision))은 44시간이 됩니다.\n\n| 월의 일수 | 주 40시간인 경우 | 주 44시간인 경우 |\n| --- | --- | --- |\n| 30일 | 171시간 25분 | 188시간 34분 |\n| 31일 | 177시간 8분 | 194시간 51분 |\n\n실적이 총 한도를 초과한 부분이 **시간외근로**, 밑도는 부분이 **부족**입니다. KIZAMI의 월별 화면에서는\n'플렉스 수지'로 표시됩니다.\n\n## 유급휴가를 사용한 날의 취급\n\n연차 유급휴가를 사용한 날은 근로한 것으로 보아 실적에 산입됩니다(전일 휴가라면 소정 근로시간분,\n반차라면 그 절반, 시간 단위라면 그 시간분). 유급휴가를 사용했다는 이유로 부족이 늘어나는 일은 없습니다.",
    },
    "attendance.late-night": {
      key: "attendance.late-night",
      audience: ["employee","admin"],
      origin: "law",
      basis: "노동기준법 제37조 제4항",
      summary: "22시부터 다음 날 5시까지의 근로는 야간근로로서 25% 이상의 가산임금 대상이 됩니다. 시간외근로와 겹치는 경우에는 가산율이 합산됩니다.",
      body: "# 야간근로(22시~다음 날 5시)의 가산\n\n**오후 10시부터 다음 날 오전 5시까지** 사이에 근로한 시간은 야간근로로 취급되어, 통상의 임금에 더하여\n**25% 이상**의 가산임금 대상이 됩니다(노동기준법 제37조 제4항).\n\n## 겹칠 때는 합산됩니다\n\n야간근로는 시간외근로나 휴일근로와 동시에 발생할 수 있습니다. 그 경우 가산율은 **합산**됩니다.\n\n| 조합 | 가산율의 기준 |\n| --- | --- |\n| 야간근로만 | 25% 이상 |\n| 시간외근로 + 야간근로 | 50% 이상(25%+25%) |\n| 법정휴일 근로 + 야간근로 | 60% 이상(35%+25%) |\n\n## KIZAMI의 범위\n\nKIZAMI는 근태 기록으로부터 야간 시간대(22시~다음 날 5시)에 해당하는 시간 수를 구분하여 집계하는 데까지를 수행합니다.\n실제 가산임금액의 계산·지급은 집계 결과를 바탕으로 급여계산 쪽에서 수행해 주십시오.",
    },
    "attendance.legal-holiday": {
      key: "attendance.legal-holiday",
      audience: ["employee","admin"],
      origin: "law",
      basis: "노동기준법 제35조·제37조 제1항",
      summary: "법정휴일은 매주 최소 1일(또는 4주를 통해 4일)의 휴일입니다. 회사가 정하는 소정휴일과는 별개의 개념이며, 법정휴일의 근로만이 35% 이상 가산(휴일근로)의 대상이 됩니다.",
      body: "# 법정휴일과 소정휴일의 차이\n\n**법정휴일**이란 노동기준법 제35조가 사용자에게 의무로 지우는 최소한의 휴일로, **매주 최소 1일**\n또는 **4주를 통해 4일 이상** 중 어느 하나를 부여해야 합니다.\n\n**소정휴일**은 회사가 취업규칙 등으로 정하는 그 밖의 휴일(이른바 '주말 휴무'의 한쪽 등)입니다.\n법률상의 최저선을 넘어 회사가 임의로 두는 것이며, KIZAMI에서는 이 두 가지를 구별하여 취급합니다.\n\n## 가산임금이 붙는 것은 법정휴일 근로뿐입니다\n\n| 휴일의 종류 | 그날 근로한 경우 |\n| --- | --- |\n| 법정휴일 | 휴일근로로서 **35% 이상**의 가산(노동기준법 제37조 제1항) |\n| 소정휴일(법정휴일 이외) | 휴일근로 가산은 붙지 않음. 다만 그 주의 근로시간이 주 40시간을 초과하면 시간외근로로서 25% 이상의 가산 |\n\n'쉬는 날에 일하면 항상 35% 증액'이라고 오해하기 쉽지만, 35%의 가산이 발생하는 것은 법정휴일에\n근로한 경우뿐입니다. 소정휴일의 근로는 법정휴일 근로가 아니라 시간외근로로 취급됩니다.",
    },
    "attendance.minute-unit": {
      key: "attendance.minute-unit",
      audience: ["employee","admin"],
      origin: "law",
      basis: "노동기준법 제24조·제37조, 昭63.3.14基発150号(1988년 3월 14일 기발 제150호)",
      summary: "근로시간은 하루 단위로 1분 단위까지 파악하는 것이 원칙입니다. 근로자에게 불이익한 절사는 임금의 전액 지급(노동기준법 제24조)·가산임금(노동기준법 제37조)에 반한다고 판단될 수 있습니다.",
      body: "# 근로시간의 단수 처리(1분 단위)\n\n근로시간은 매일의 실적을 **1분 단위**로 계산하는 것이 원칙입니다. '15분 미만 절사', '30분 미만 절사'\n와 같이 실제로 근로한 시간보다 짧게 반올림하여 임금을 줄이는 취급은 노동기준법 제24조(임금의 전액 지급)나\n제37조(가산임금의 지급)에 반한다고 판단될 수 있습니다.\n\n## 유일한 예외: 1개월 합계에 대한 단수 처리\n\n매일의 근로시간 자체를 반올림할 수는 없지만, **1개월분의 시간외·휴일·야간근로의 합계**에\n1시간 미만의 단수가 생긴 경우에 한하여 30분 미만은 절사하고 30분 이상은 절상하는 취급이 인정됩니다\n(昭63.3.14基発150号 — 1988년 3월 14일 기발 제150호 통달).\n\n| 대상 | 단수 처리 |\n| --- | --- |\n| 매일의 근로시간 | 절사 불가(1분 단위로 계산) |\n| 1개월의 시간외근로 등의 합계 | 30분 미만 절사·30분 이상 절상 가능 |\n\n'매일의 근태 기록을 반올림해도 된다'고 오해하기 쉽지만, 인정되는 것은 월 단위 합계에 대해서뿐입니다.",
    },
    "attendance.warnings": {
      key: "attendance.warnings",
      audience: ["employee","admin"],
      origin: "product",
      summary: "근태 기록이 불완전할 때 KIZAMI는 부족하거나 모순된 부분을 보수적으로 해석합니다. 대응하는 기록이 없는 구간은 집계에 포함하지 않고, 앞뒤가 맞지 않는 기록은 무효화합니다.",
      body: "# 근태 기록이 불완전할 때의 취급\n\n기록 누락이나 오조작으로 출퇴근이나 휴게 기록이 갖추어지지 않는 경우가 있습니다. KIZAMI는 이러한 경우를\n**보수적으로 해석**합니다.\n\n## 보수적으로 해석하는 이유\n\n근로시간은 '실제로 근로한 시간'을 올바르게 기록해야 합니다. 기록이 빠진 구간을\n추측으로 메워 근로시간으로 계산해 버리면, 실태보다 많은(또는 적은) 근로시간을\n기록하게 될 수 있습니다. KIZAMI는 확증이 없는 구간을 근로시간으로 지어내지 않기 위해\n**부족한 정보는 집계에 포함하지 않는** 방침을 취하고 있습니다. 실제 근로시간과 어긋나는 경우에는\n정정 신청으로 올바른 기록을 보완해 주십시오.\n\n## 주요 패턴\n\n| 상황 | KIZAMI의 취급 |\n| --- | --- |\n| 퇴근 기록이 없음 | 해당 근무 구간을 집계에서 제외(근로한 시간으로 세지 않음) |\n| 근무 중에 중복된 출근 기록이 있음 | 나중의 중복된 출근 기록을 무효로 함 |\n| 출근하지 않은 상태에서의 퇴근 기록 | 해당 퇴근 기록을 무효로 함 |\n| 근무 외의 휴게 기록 | 해당 휴게 기록을 무효로 함 |\n| 휴게 중에 중복된 휴게 시작 기록이 있음 | 나중의 중복된 휴게 시작 기록을 무효로 함 |\n| 대응하는 휴게 시작이 없는 휴게 종료 기록 | 해당 휴게 종료 기록을 무효로 함 |\n| 휴게 중에 퇴근 기록이 있음 | 휴게를 마치고 퇴근한 것으로 취급 |\n\n이들은 월별 화면의 경고 열에 표시됩니다. 실제 근로시간과 다른 경우에는 그날의 '정정'에서\n올바른 기록을 신청해 주십시오.",
    },
    "attendance.work-system": {
      key: "attendance.work-system",
      audience: ["employee","admin"],
      origin: "law",
      basis: "노동기준법 제32조(근로시간)·제32조의3(플렉스타임제)",
      summary: "근로시간제에 따라 '시간외근로'의 의미가 달라집니다. 고정 근로시간제는 1일 8시간·1주 40시간을 초과한 부분, 플렉스타임제는 정산기간(1개월)의 총 근로시간 한도를 초과한 부분이 시간외근로입니다.",
      body: "# 근로시간제와 '시간외'의 의미\n\n같은 '하루 10시간 근무'라도 적용되고 있는 근로시간제에 따라 시간외근로가 되는지 여부가 달라집니다.\n\n## 고정 근로시간제\n\n**1일 8시간·1주 40시간**이라는 상한이 있고, 이를 초과한 부분이 그 자리에서 시간외근로가 됩니다\n(노동기준법 제32조). 월말을 기다리지 않고 그날 안에 확정됩니다.\n\n소정 근로시간이 7시간인 회사에서 7시간 30분 근무한 경우, 이 30분은 소정을 초과하지만\n1일 8시간 이내이므로 **법정 시간외에는 해당하지 않습니다**. 가산임금은 필요 없지만,\n근로한 만큼의 임금은 당연히 지급됩니다. KIZAMI에서는 이를 '법정 내 잔업(법정 근로시간 이내의 초과근무)'으로 구별하여 표시합니다.\n\n## 플렉스타임제\n\n정산기간(KIZAMI에서는 1개월)의 **총 근로시간 한도(総枠)**와 실적을 비교하여, 초과한 부분이 시간외근로가 됩니다\n(노동기준법 제32조의3). 총 한도는 '주 법정 근로시간 × 해당 월의 역일수 ÷ 7'로 정해집니다.\n\n**하루 단위의 시간외근로라는 개념이 없습니다.** 어느 날에 10시간 근무하더라도,\n월의 총 한도 안에 들어가 있다면 시간외근로가 아닙니다. 시업·종업 시각을 스스로 정할 수 있다는 것이\n이 제도의 취지이므로, 하루마다 상한을 두지 않는 구조로 되어 있습니다.\n\n이 때문에 플렉스타임제(선택적 근로시간제)가 적용되는 분의 월별 목록에는 **시간외 열이 표시되지 않습니다**.\n표시하지 않는 것이 아니라, 그날에는 아직 정해지지 않았다는 것이 정확한 설명입니다.\n월 중간의 예상치는 '플렉스 수지'에서 확인할 수 있습니다.\n\n## 어느 쪽이든 달라지지 않는 것\n\n다음의 것들은 근로시간제와 관계없이 동일하게 취급됩니다.\n\n| | 내용 |\n| --- | --- |\n| 야간근로 | 22시~다음 날 5시의 근로. 25% 이상의 가산(노동기준법 제37조 제4항) |\n| 법정휴일 근로 | 주 1일의 법정휴일의 근로. 35% 이상의 가산(노동기준법 제37조 제1항) |\n| 휴게 | 6시간 초과 시 45분, 8시간 초과 시 60분(노동기준법 제34조) |\n| 연차 유급휴가 | 부여 일수·연 5일의 사용 의무(노동기준법 제39조) |",
      companyExample: "당사는 원칙적으로 플렉스타임제(정산기간 1개월·코어타임 없음)를 적용합니다.\n적용되는 제도는 근로계약서에 기재하고 있습니다. 본인의 제도를 알 수 없는 경우에는 인사부에 문의해 주십시오.",
    },
    "closing.amend": {
      key: "closing.amend",
      audience: ["admin"],
      origin: "product",
      summary: "마감 후 정정은 월의 확정을 해제하지 않고 승인된 1건분의 변경만을 반영하는 구조입니다. 반영 후에도 당초 마감 시점의 수치와의 차이가 계속 표시됩니다.",
      body: "# 마감 후 정정\n\n마감이 끝난 달에 대한 정정 신청이나 휴가 신청이 승인된 경우, 월 전체의 확정을 해제하지 않고도\n그 **1건분의 변경만**을 반영하여 해당 사용자의 집계를 재계산할 수 있습니다. 달은 마감된 상태 그대로입니다.\n\n## 당초 값과의 차이가 남습니다\n\n마감 후 정정을 반영하면 그달은 '마감 후 정정 있음' 상태가 됩니다. 마감한 시점의 당초\n수치와 정정을 반영한 후의 현재 수치가 모두 보존되며, 월별 화면에는 **당초 값과의 차이**가\n계속 표시됩니다. 어느 구분이 얼마나 달라졌는지를 나중에 추적할 수 있습니다.\n\n## 마감 해제와의 차이\n\n| 조작 | 영향 범위 | 달의 상태 |\n| --- | --- | --- |\n| 마감 해제 | 월 전체를 자유롭게 편집 가능하게 함 | 미확정으로 되돌아감 |\n| 마감 후 정정 | 승인된 1건분만을 반영함 | 확정된 상태 그대로(차이가 기록됨) |\n\n달을 열지 않아도 되는 만큼, 마감 후 정정은 영향 범위가 작은 변경에 적합합니다. 월 전체를 재검토할 필요가 있는 경우에는\n마감 해제를 사용해 주십시오.",
    },
    "closing.execute": {
      key: "closing.execute",
      audience: ["employee","admin"],
      origin: "product",
      summary: "월 마감을 실행하면 그달의 근태 기록이 확정되고, 이후의 근태 기록·정정에는 신청과 승인이 필요해집니다. 확정된 시점의 수치는 스냅샷으로 고정됩니다.",
      body: "# 월 마감\n\n마감은 대상 월의 근태 기록을 '확정'시키는 조작입니다. 마감한 시점의 구분별 합계·플렉스 수지 등의\n수치는 **스냅샷**으로 고정되며, 이후 근태 기록이나 집계 방법이 바뀌더라도 소급하여 변화하지 않습니다.\n\n## 마감한 후의 취급\n\n- 마감 후에는 근태 기록의 추가·정정·취소가 불가능해지며, 변경하려면 **정정 신청과 그 승인**이 필요합니다\n- 마감을 해제(확정 해제)하면 그달은 다시 자유롭게 편집할 수 있는 상태로 되돌아갑니다. 해제에는 별도의 권한이 필요합니다\n- 마감·해제·마감 후 정정의 모든 조작은 감사 로그에 기록됩니다\n\n마감은 급여계산 등 후속 처리의 기점이 되므로, 마감한 달의 수치가 의도치 않게 바뀌지 않도록 하기\n위한 구조입니다.",
      companyExample: "매월 5일에 전월분을 마감합니다. 그때까지 정정 신청을 완료해 주십시오.\n마감 후의 정정이 필요한 경우에는 소속장을 통해 인사부로 연락해 주십시오.",
    },
    "closing.unlock": {
      key: "closing.unlock",
      audience: ["admin"],
      origin: "product",
      summary: "확정된 월 마감을 해제하여 해당 월의 근태 기록을 다시 정정할 수 있는 상태로 되돌립니다. 해제·재정정·재마감 조작은 모두 감사 로그에 기록됩니다.",
      body: "# 마감 해제\n\n월 마감을 해제하면 확정되어 있던 해당 월의 근태 기록을 다시 정정할 수 있게 됩니다.\n\n- 이 조작에는 '마감 해제' 권한이 필요합니다\n- 이미 급여 계산에 사용된 달을 해제할 때에는 내보내기 대상과의 정합성에 주의가 필요합니다\n- 누가 언제 해제했는지는 마감 상태 이력으로 보존되며, 감사 로그에서도 확인할 수 있습니다",
    },
    "correction.flow": {
      key: "correction.flow",
      audience: ["employee","admin"],
      origin: "product",
      summary: "근태 기록은 직접 편집할 수 없습니다. 추가·정정·취소는 모두 정정 신청으로 제출하며, 승인된 후에야 근태 기록에 반영됩니다. 승인·반려·철회를 포함한 모든 변경은 감사 로그에 기록됩니다.",
      body: "# 근태 기록 정정 신청의 흐름\n\n근태 기록(출퇴근·휴게 기록) 자체를 직접 고쳐 쓸 수는 없습니다. 근태 기록을 추가·정정·취소하려면\n**정정 신청**으로 제출해야 하며, 승인된 결과로서만 근태 기록에 반영됩니다.\n\n## 신청의 종류\n\n- **추가**: 기록하지 못한 출퇴근·휴게를 새로 등록하는 신청\n- **정정**: 기존 기록의 시각이나 종류를 변경하는 신청\n- **취소**: 기존 기록을 없던 것으로 하는 신청\n\n## 승인까지의 흐름\n\n1. 본인(또는 대리 권한을 가진 담당자)이 사유를 붙여 신청한다(상태: 신청 중)\n2. 승인 권한을 가진 담당자가 내용을 확인하고 승인 또는 반려한다\n3. 승인되면 근태 기록에 반영되고 월별 집계에도 반영된다. 반려된 경우에는 반영되지 않는다\n4. 신청 중인 동안에는 본인이 철회할 수도 있다\n\n대상 월이 이미 마감된 경우, 승인하려면 마감 해제 권한이 별도로 필요합니다.\n\n## 모두 감사 로그에 남는다\n\n신청의 제출·승인·반려·철회는 언제·누가 했는지를 포함하여 모두 감사 로그에 기록됩니다.\n승인자와 신청자가 동일 인물인 경우(자기 승인)에도 그러한 사실이 기록으로 남습니다.",
      companyExample: "신청은 대상일의 다음 영업일 중에 제출해 주십시오.\n성수기(월말 마지막 3영업일)의 승인은 다음 영업일로 미뤄질 수 있습니다.",
    },
    "law.versioning": {
      key: "law.versioning",
      audience: ["admin"],
      origin: "product",
      summary: "법 개정은 미리 등록된 시행일이 되면 자동으로 전환됩니다. 과거 기간의 계산은 그 기간 당시에 유효했던 법령 그대로 변하지 않습니다.",
      body: "# 법 개정의 자동 전환\n\nKIZAMI는 노동기준법(일본의 법률) 등의 법령 규칙을 '시행일이 붙은 버전'으로 관리합니다. 장래의\n법 개정을 시행 전에 미리 등록해 두면 그 시행일이 된 순간 자동으로 새로운 규칙으로 전환되며,\n테넌트 프로필 화면에는 적용 예정인 법 개정으로 사전에 표시됩니다.\n\n## 과거 기간은 당시의 규칙 그대로\n\n법 개정이 반영되는 것은 시행일 이후의 기간뿐입니다. 이미 마감된 달은 물론이고, 마감되지 않은\n과거의 달이라 하더라도 집계에 사용되는 법령 규칙은 그 **기간 당시에 유효했던 것**입니다.\n최신 규칙으로 과거분이 소급하여 재계산되는 일은 없습니다.\n\n이를 통해 법이 개정될 때마다 과거의 집계 결과가 바뀌어 버리는(마감된 숫자와 어긋나는) 것을\n방지하고 있습니다.",
    },
    "leave.grant": {
      key: "leave.grant",
      audience: ["employee","admin"],
      origin: "law",
      basis: "노동기준법 제39조 제1항·제2항, 제115조",
      summary: "연차 유급휴가는 입사일로부터 6개월 계속 근무하고 전 근로일의 80% 이상 출근하면 10일이 부여되며, 이후 근속연수에 따라 최대 20일까지 늘어납니다. 부여된 휴가는 부여일로부터 2년이 지나면 시효로 소멸합니다.",
      body: "# 연차 유급휴가의 법정 부여 일수와 시효\n\n채용일로부터 **6개월간 계속 근무**하고 그 기간의 전 근로일의 **80% 이상 출근**한 근로자에게는\n연차 유급휴가가 부여됩니다(노동기준법 제39조 제1항). 이후 근속연수에 따라 일수가 늘어납니다\n(같은 조 제2항).\n\n## 근속연수별 부여 일수(풀타임인 경우)\n\n| 근속연수 | 부여 일수 |\n| --- | --- |\n| 6개월 | 10일 |\n| 1년 6개월 | 11일 |\n| 2년 6개월 | 12일 |\n| 3년 6개월 | 14일 |\n| 4년 6개월 | 16일 |\n| 5년 6개월 | 18일 |\n| 6년 6개월 이후 | 20일 |\n\n어느 구분이든 대상 기간의 전 근로일의 80% 이상 출근한 것이 조건입니다.\n\n## 주 소정 근로일수가 적은 경우(비례부여)\n\n주 소정 근로시간이 30시간 미만이면서 주 소정 근로일수가 4일 이하(주 이외의 기간으로 정하는\n경우에는 연간 소정 근로일수가 216일 이하)인 근로자에게는 위 표와는 별도로 **비례부여**\n일수표가 적용됩니다(일본 노동기준법 제39조 제3항, 동법 시행규칙 제24조의3).\n\n| 주 소정 근로일수 | 6개월 | 1년 6개월 | 2년 6개월 | 3년 6개월 | 4년 6개월 | 5년 6개월 | 6년 6개월 이후 |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| 4일 | 7일 | 8일 | 9일 | 10일 | 12일 | 13일 | 15일 |\n| 3일 | 5일 | 6일 | 6일 | 8일 | 9일 | 10일 | 11일 |\n| 2일 | 3일 | 4일 | 4일 | 5일 | 6일 | 6일 | 7일 |\n| 1일 | 1일 | 2일 | 2일 | 2일 | 3일 | 3일 | 3일 |\n\nKIZAMI는 멤버별 「연차 부여 구분」에 따라 이 표로 일수를 계산합니다. 구분은 주 소정\n근로시간·일수로부터 자동 판정하지 않고, **관리자가 취업규칙·근로계약에 근거하여 설정**합니다\n(멤버 관리 화면). 구분이 설정되지 않은 멤버는 일반(주 5일 이상)으로 취급됩니다.\n\n또한 비례부여라도 **1회 부여 일수가 10일 이상이 되면 연 5일 취득 의무의 대상**입니다\n(주 4일 구분의 3년 6개월=10일 등).\n\n## 시효는 2년\n\n부여된 연차 유급휴가는 **부여일로부터 2년**이 지나면 시효로 소멸합니다(노동기준법 제115조). 전년도분의\n미사용분이 당해 연도로 이월되는 것은 이 2년 이내의 분뿐입니다.",
      companyExample: "당사는 법정을 상회하는 취급으로, 입사일에 앞당겨 5일을 부여하고 있습니다.\n자세한 내용은 취업규칙 제◯조를 확인해 주십시오.",
    },
    "leave.hourly": {
      key: "leave.hourly",
      audience: ["employee","admin"],
      origin: "law",
      basis: "노동기준법 제39조 제4항, 平21.5.29基発0529001号(2009년 5월 29일 기발 제0529001호 통달)",
      summary: "시간 단위로 연차 유급휴가를 사용할 수 있는 것은 노사협정이 있는 경우에 한하여 연 5일분까지입니다. 1일당 시간 수는 소정 근로시간을 1시간 단위로 올림하여 계산합니다.",
      body: "# 시간 단위의 연차 유급휴가\n\n연차 유급휴가는 원칙적으로 1일 단위로 사용하는 것이지만, **노사협정을 체결한 경우에 한하여**\n시간 단위로 사용할 수 있습니다.\n\n## 연 5일분이 상한\n\n시간 단위로 사용할 수 있는 것은 **연 5일분까지**입니다. 이는 법률상의 상한이며, 노사협정으로\n이보다 적게 정할 수는 있지만 초과할 수는 없습니다.\n\n'5일분'의 시간 수는 1일의 소정 근로시간을 **1시간 단위로 올림하여** 계산합니다.\n\n| 소정 근로시간 | 1일당 | 연 5일분 |\n| --- | --- | --- |\n| 8시간 | 8시간 | 40시간 |\n| 7시간 30분 | **8시간**(올림) | 40시간 |\n| 7시간 | 7시간 | 35시간 |\n\n전년도에서 이월한 연차 유급휴가를 시간 단위로 사용하는 경우에도 **당해 연도의 5일 한도에 포함하여**\n계산합니다. 이월분이라고 해서 별도 한도가 되지는 않습니다.\n\n## 연 5일 사용 의무에는 산입되지 않는다\n\n시간 단위 사용은 [연 5일의 사용 의무](./leave-mandatory-five-days)를 충족하기 위한 사용으로는\n인정되지 않습니다. 의무를 충족하려면 전일 휴가 또는 반차로 사용해야 합니다.",
      companyExample: "당사는 1시간 단위로 사용할 수 있습니다(노사협정에 따름).\n반일을 초과하여 사용하려는 경우에는 반차를 이용해 주십시오.",
    },
    "leave.mandatory-five-days": {
      key: "leave.mandatory-five-days",
      audience: ["employee","admin"],
      origin: "law",
      basis: "노동기준법 제39조 제7항·제8항(2019년 4월 1일 시행)",
      summary: "연 10일 이상의 연차 유급휴가가 부여된 사람은 부여일로부터 1년 이내에 5일을 사용해야 합니다. 반차는 0.5일로 계산되지만 시간 단위 사용은 계산되지 않습니다.",
      body: "# 연 5일의 사용 의무\n\n연 10일 이상의 연차 유급휴가가 부여된 사람은 **부여일로부터 1년 이내에 5일**을 사용해야 합니다.\n이는 일하는 사람의 권리인 동시에 회사에 부과된 의무이기도 합니다.\n\n## 계산 방법에 주의\n\n| 사용 단위 | 5일에 산입되는지 |\n| --- | --- |\n| 전일 휴가 | 1.0일로 계산됨 |\n| 반차(오전·오후) | **0.5일로 계산됨** |\n| 시간 단위 | **계산되지 않음** |\n\n시간 단위의 연차 유급휴가는 이 5일의 의무를 충족하기 위한 사용으로는 인정되지 않습니다.\n시간 단위로 40시간을 사용하더라도 의무의 충족은 0일 그대로입니다. 의무를 충족하려면\n전일 휴가 또는 반차로 사용해야 합니다.\n\n## 기한\n\n기한은 '부여일로부터 1년 후'입니다. 부여일은 사람마다 다르기 때문에(입사일 기준인 경우)\n기한도 사람마다 다릅니다. KIZAMI의 유급휴가 화면에서 자신의 기한과 남은 일수를 확인할 수 있습니다.\n\n기한이 가까워지면 알림이 발송됩니다(90일 전·30일 전).",
      companyExample: "사용 예정은 매년 4월 말까지 소속장에게 신청해 주십시오.\n미사용이 3일 이상 남아 있는 분께는 10월에 인사부에서 개별적으로 연락드립니다.",
    },
    "overtime.60h": {
      key: "overtime.60h",
      audience: ["employee","admin"],
      origin: "law",
      basis: "노동기준법 제37조 제1항 단서(2010년 4월 1일 시행, 중소기업은 2023년 4월 1일부터 적용)",
      summary: "1개월에 60시간을 초과하는 시간외근로는 초과한 부분의 가산임금률이 50% 이상이 됩니다. 중소기업에는 유예가 있었으나 2023년 4월 1일부터는 모든 기업에 적용되고 있습니다.",
      body: "# 월 60시간 초과 시간외근로의 가산율\n\n1개월의 시간외근로가 **60시간을 초과한** 경우, 그 **초과한 부분**에 대해서는 가산임금률이\n**50% 이상**이 됩니다(노동기준법 제37조 제1항 단서).\n\n## 60시간까지의 부분은 달라지지 않는다\n\n50%가 되는 것은 60시간을 초과한 부분뿐이며, 60시간까지의 부분은 통상적인 시간외근로의 가산율\n(25% 이상) 그대로입니다. '월 60시간을 초과하면 전부 50%'인 것은 아닙니다.\n\n| 시간외근로의 구분 | 가산율 |\n| --- | --- |\n| 60시간까지 | 25% 이상 |\n| 60시간을 초과한 부분 | 50% 이상 |\n\n## 중소기업의 유예는 종료되었다\n\n이 50% 규칙은 대기업에는 2010년 4월 1일부터 적용되어 왔지만, 중소기업에는 유예조치가\n있었습니다. **2023년 4월 1일**부터는 중소기업에도 적용되고 있으며, 현재는 기업 규모를 불문하고\n동일한 규칙이 적용됩니다.",
    },
    "permission.presets": {
      key: "permission.presets",
      audience: ["admin"],
      origin: "product",
      summary: "권한 프리셋은 여러 개를 할당하면 합산되며, 승인·실행 등 조작 계열 권한에는 대응하는 열람 권한이 자동으로 포함됩니다. 특정 권한을 상쇄하는 거부 규칙은 없습니다.",
      body: "# 권한 프리셋의 개념\n\n권한 프리셋은 권한의 ON/OFF와 적용 범위(스코프)를 조합하여 정의하는 할당 단위입니다.\n\n## 여러 개를 할당하면 합산된다\n\n한 명의 멤버에게 여러 프리셋을 할당한 경우, 가질 수 있는 권한은 **합산(덧셈)**됩니다.\n동일한 권한에 서로 다른 스코프가 할당되어 있는 경우에는 더 넓은 쪽의 스코프가 유효해집니다.\n\n## 조작은 열람을 함의한다\n\n승인·실행·관리 등 조작 계열의 권한을 ON으로 하면, 그 조작에 필요한 범위의 열람 권한은\n자동으로 유효해집니다. 예를 들어 '근태 기록 정정 신청을 승인할 수 있음'을 ON으로 하면, 대상 범위의\n정정 신청·근태 기록 열람도 별도로 ON으로 하지 않아도 할 수 있습니다.\n\n## 거부(deny) 규칙은 존재하지 않는다\n\nKIZAMI의 권한 모델에는 특정 권한을 명시적으로 상쇄하는 '거부' 규칙이 없습니다.\n여러 프리셋을 할당한 결과 의도치 않게 넓은 권한을 부여하게 되지 않도록, 할당 시에는\n각 프리셋이 실제로 ON으로 하고 있는 권한의 목록을 확인해 주십시오.",
    },
    "privacy.internal-terms-template": {
      key: "privacy.internal-terms-template",
      audience: ["employee","admin"],
      origin: "product",
      summary: "정확한 근태 기록의 의무·대리 기록 금지 등 근태 기록에 관한 사내 이용 규약의 템플릿을 '설정 > 개인정보' 화면에서 받을 수 있습니다.",
      body: "# 근태 기록에 관한 사내 이용 규약의 템플릿\n\n정확한 근태 기록(출퇴근·휴게 기록)의 의무·대리 기록 금지·기록을 잊은 경우의 정정 신청 절차·\n부정 기록의 취급을 정리한 사내 이용 규약의 템플릿을 '설정 > 개인정보' 화면에서 받을 수 있습니다.\n\n이 템플릿은 그대로 취업규칙의 일부로 삼거나, 별지로서 직원에게 주지시키는 등\n자사의 운용에 맞추어 활용할 수 있습니다. 취업규칙 링크를 설정해 둔 경우에는\n템플릿 말미에 자동으로 안내가 붙습니다.",
      companyExample: "본 규약은 취업규칙 제◯조(복무규율)의 일부로 취급합니다. 위반 시의 취급은 취업규칙의 징계 규정에 따릅니다.",
    },
    "privacy.notice-template": {
      key: "privacy.notice-template",
      audience: ["employee","admin"],
      origin: "product",
      summary: "근태 기록·IP·UA·GPS 좌표 등의 개인정보에 대해 직원에게 공표하는 프라이버시 통지의 템플릿을 '설정 > 개인정보' 화면에서 받을 수 있습니다. 현재의 GPS 설정·보존 기간을 바탕으로 자동 생성됩니다.",
      body: "# 직원용 프라이버시 통지의 템플릿\n\n근태 기록·IP 주소·사용자 에이전트·GPS 좌표(활성화된 경우)는 직원의 개인정보입니다.\n이들의 취득 목적·보존 기간을 직원에게 공표할 의무(개인정보보호법 제17조·제18조·제21조)를\n지는 것은 KIZAMI 프로젝트가 아니라 **도입 기업**입니다.\n\nKIZAMI는 '설정 > 개인정보' 화면에서 현재의 테넌트 설정(GPS의 활성/비활성·보존 기간)을\n반영한 프라이버시 통지의 템플릿을 자동 생성합니다. GPS가 비활성인 경우에는 위치정보에 관한 항목은\n표시되지 않습니다.\n\n## 사용 방법\n\n1. '설정 > 개인정보' 화면에서 생성된 문안을 확인한다\n2. 자사의 실정(공개·정정 청구 창구 등)에 맞추어 검토한다\n3. 직원에게 주지시킨다(게시·인트라넷 게재·근로계약서 첨부 등 방법은 자사에서 선택한다)\n\n생성되는 문안은 어디까지나 템플릿이며 법적 조언이 아닙니다. 내용에 우려가 있는 경우에는\n사회보험노무사(社会保険労務士)·변호사 등 전문가에게 확인해 주십시오.",
      companyExample: "당사는 2026년 8월에 본 템플릿을 바탕으로 프라이버시 통지를 작성하여 인트라넷의 '공지사항'에 게시했습니다.\n개정한 경우에는 게시일을 여기에 추가로 기재해 주십시오.",
    },
    "privacy.retention-after-leaving": {
      key: "privacy.retention-after-leaving",
      audience: ["employee","admin"],
      origin: "law",
      basis: "노동기준법 제109조·부칙 제143조 제2항, 개인정보보호법 제22조",
      summary: "퇴직 후에도 근태 기록은 법률에 의해 보존이 의무화되어 있습니다(원칙 5년, 경과조치에 따라 당분간 3년). 이 기간이 경과한 후 성명·이메일 주소 등 개인을 특정할 수 있는 정보는 소거되지만, 근태 기록 자체는 남습니다.",
      body: "# 퇴직 후 기록의 보존과 소거\n\n퇴직하더라도 근태 기록이 곧바로 사라지는 것은 아닙니다. **법률이 보존을 의무화하고 있기**\n때문입니다.\n\n## 두 법률이 서로 반대 방향을 향하고 있다\n\n| 법률 | 요구하는 내용 |\n| --- | --- |\n| 노동기준법 제109조 | 임금대장·출근부 등의 기록을 **보존하지 않으면 안 된다**(원칙 5년. 부칙 제143조 제2항의 경과조치에 따라 당분간 3년) |\n| 개인정보보호법 제22조 | 이용할 필요가 없어진 개인데이터는 **지체 없이 소거하도록 노력하지 않으면 안 된다** |\n\n퇴직자에 대해서는 이 둘이 정면으로 충돌합니다. 기록을 소거하면 노동기준법에 반하고,\n계속 남겨 두면 개인정보보호법의 노력의무에 반하는 형태입니다.\n\n보존의무가 '하지 않으면 안 된다'(의무)이고 소거가 '노력하지 않으면 안 된다'(노력의무)인\n이상, **보존 기간이 경과할 때까지는 남겨 두는** 것이 올바른 순서입니다.\n\n## 보존 기간의 기산일\n\n노동기준법 제109조의 보존 기간은 '최후의 기재일'부터 셉니다. 퇴직자의 경우 마지막 근태 기록이\n그날에 해당합니다. KIZAMI는 **퇴직 처리를 수행한 날**을 기산일로 취급합니다. 퇴직 처리는\n최종 출근일 이후에 이루어지므로, 이 취급은 실제 기산일보다 **뒤로** 밀릴 수는 있어도\n앞당겨지는 일은 없어 의무 기간을 잠식하지 않습니다.\n\n## 기간이 경과한 후에 무슨 일이 일어나는가\n\n보유 기간이 지나면 관리자는 퇴직자의 개인데이터를 소거할 수 있게 됩니다.\n이때 사라지는 것과 남는 것은 다음과 같습니다.\n\n| 대상 | 취급 |\n| --- | --- |\n| 성명·이메일 주소 | 개인을 식별할 수 없는 표기로 치환한다 |\n| 비밀번호·2요소 인증·로그인 정보 | 삭제한다 |\n| 알림 설정·단말 정보(IP 주소·브라우저 정보·위치정보) | 삭제한다 |\n| 근태 기록(기록된 시각·집계 결과·마감한 달의 수치) | **남긴다**(보존의무 때문) |\n| 감사 로그 | **남긴다**(변경하지 않는다. 표시되는 성명만 익명화된다) |\n\n즉 '기록을 소거하는' 것이 아니라 **기록에서 '누구의 기록인가'를 제거하는** 조작입니다.\n근태 기록의 행 자체는 사라지지 않으므로, 과거에 마감한 달의 집계값은 소거 전후로 달라지지\n않습니다.\n\n이 조작은 **되돌릴 수 없습니다**. 퇴직 후 본인의 기록에 대한 공개를 희망하시는 경우에는\n보유 기간이 경과하기 전에 회사의 창구로 연락해 주십시오.\n\n## 보유 기간은 회사가 선택합니다\n\n3년(경과조치)과 5년(원칙) 중 어느 쪽을 채택할지는 회사가 정합니다. KIZAMI의 기본값은 **5년**입니다\n— 경과조치는 언젠가 종료되며, 그때 3년인 채로 두면 보존의무를 충족할 수 없게 되기 때문입니다.",
      companyExample: "당사는 보유 기간을 3년(경과조치)으로 하고 있습니다.\n퇴직 후 본인의 기록에 대한 공개를 희망하시는 경우에는 이 기간 내에 인사부로 연락해 주십시오.",
    },
    "tenant.special-provision": {
      key: "tenant.special-provision",
      audience: ["admin"],
      origin: "law",
      basis: "노동기준법 제40조, 노동기준법 시행규칙 제25조의2",
      summary: "상업·영화연극업·보건위생업·접객오락업으로서 상시 10인 미만인 사업장은 주 법정 근로시간이 44시간이 됩니다. 과거의 경과조치가 아니라 현행 제도입니다.",
      body: "# 特例措置対象事業場(특례조치 대상 사업장·주 44시간)\n\n주 법정 근로시간은 원칙적으로 40시간이지만, 다음 조건을 **모두** 충족하는 사업장은 **44시간**이 됩니다.\n\n1. 업종이 **상업·영화연극업·보건위생업·접객오락업** 중 하나\n2. 상시 사용하는 근로자가 **10인 미만**\n\n이는 1997년 주 40시간제 완전 실시 때 마련된 것으로, 과거의 경과조치가 아니라\n**현재도 유효한 제도**입니다.\n\n## 집계에 미치는 영향\n\n주 법정 근로시간은 [플렉스타임제(선택적 근로시간제)의 총 근로시간 한도(総枠)](./attendance-flex-frame)\n계산에 사용되므로, 해당 여부에 따라 월의 총 한도가 달라집니다.\n\n| 월의 일수 | 주 40시간 | 주 44시간 |\n| --- | --- | --- |\n| 30일 | 171시간 25분 | 188시간 34분 |\n| 31일 | 177시간 8분 | 194시간 51분 |\n\n30일인 달에서 약 17시간의 차이가 발생합니다. **해당하는데도 설정하지 않으면, 본래 시간외가 아닌 근로가\n시간외로 계상됩니다.**\n\n## 설정과 재검토\n\n'설정 → 테넌트 프로필'에서 전환합니다. 판정은 사업장 단위이므로,\n**직원 수가 10인 이상이 된 시점에 해당하지 않게 됩니다**. 인원의 증감이 있었을 때에는\n설정을 재검토해 주십시오(KIZAMI는 인원 수로 자동 판정하지 않습니다).",
      companyExample: "본 사업장은 소매업·직원 7명이므로 특례조치 대상 사업장(特例措置対象事業場)에 해당합니다(2026년 4월 시점).\n직원 수가 10명 이상이 된 경우에는 신속하게 설정을 재검토해 주십시오.",
    },
  },
  zh: {
    "agreement36.limits": {
      key: "agreement36.limits",
      audience: ["employee","admin"],
      origin: "law",
      basis: "《劳动基准法》第36条第4款、第5款、第6款(2019年4月1日施行，中小企业自2020年4月1日施行)",
      summary: "依据36协定可以延长的加班时间原则上为每月45小时、每年360小时。只有在存在临时性特别情况时，才能通过劳资协定中签订的特别条款延长至每年720小时等上限，但该上限还附带次数和多月平均值方面的限制。",
      body: "# 36协定的上限规制\n\n要安排加班(法定时间外劳动)或休息日劳动，必须事先签订并申报36协定(36協定，依据《劳动基准法》第36条签订的劳资协定)。\n其延长时间设有附带罚则的上限(《劳动基准法》第36条第4款至第6款)。\n\n## 原则(限度时间)\n\n| 区分 | 上限 |\n| --- | --- |\n| 每月 | 45小时 |\n| 每年 | 360小时 |\n\n## 特别条款(存在临时性特别情况时)\n\n在需要超过原则上限安排劳动的情况下，以**事先签订并申报了附带特别条款的36协定**为前提，\n可以延长至以下上限。若没有特别条款，则不允许进行此项延长。\n\n| 区分 | 上限 |\n| --- | --- |\n| 年度加班时间 | 720小时以内 |\n| 单月(含休息日劳动) | 不满100小时 |\n| 多月平均(2〜6个月平均，含休息日劳动) | 80小时以内 |\n| 可超过每月45小时的次数 | 每年至多6次 |\n\n特别条款终究只是为存在\"临时性特别情况\"的月份而设的，\n其宗旨并不是允许常态化地按上限满额安排劳动。",
      companyExample: "在预计将超过每月40小时的时点，请通过所属主管向人事部咨询。\n特别条款的适用由人事部统一管理，需要事先获得批准。",
    },
    "attendance.auto-break": {
      key: "attendance.auto-break",
      audience: ["employee","admin"],
      origin: "product",
      basis: "以《劳动基准法》第34条(休息时间)为前提的 KIZAMI 汇总规格",
      summary: "启用自动扣除后，即使没有休息时间的打卡记录，也会从实际劳动时间中扣除规定的休息时间。对于实际未能休息的日子，提出撤销申请后将不予扣除，同时会显示休息时间不足的警告。",
      body: "# 休息时间的自动扣除\n\n根据公司的设置，即使不进行休息时间的打卡，系统也会按照工作时长，\n从实际劳动时间中自动扣除规定的休息时间。\n\n## 行为的种类\n\n| 设置 | 行为 |\n| --- | --- |\n| 打卡方式 | 仅扣除已打卡的休息时间(无自动扣除) |\n| 自动扣除 | 无论有无打卡，都按照工作时长扣除规定的休息时间 |\n| 并用 | 先使用已打卡的休息时间，仅对不足规定时长的部分追加扣除 |\n\n默认为**打卡方式**(自动扣除关闭)。是否使用自动扣除取决于公司的设置，\n如需启用，请在上表中选择\"自动扣除\"或\"并用\"。\n\n自动扣除的时间，在月度一览中会与来自打卡的休息时间**分开显示**。\n这是因为需要让本人能够察觉\"自己并未打卡，休息时间却被扣除了\"这一情况。\n\n## 实际未能休息时\n\n自动扣除是以\"应当已经休息过\"为前提进行扣除的机制。\n**如果在实际未能休息的日子里照常扣除，工作过的时间就会被记录得过少。**\n\n请针对该日提出**撤销申请**(取消自动扣除的申请)。获得批准后：\n\n- 该日的自动扣除将被取消，实际劳动时间恢复为与打卡一致\n- 如果休息时间未达到法律规定的最低时长(超过6小时为45分钟，超过8小时为60分钟)，\n  将显示休息时间不足的警告 — 这表明公司未能履行让员工休息的义务，\n  而不是您的记录有误\n\n## 扣除后可能低于适用基准时\n\n在工作6小时5分钟的日子扣除45分钟后，剩余为5小时20分钟，\n\"超过6小时则45分钟\"这一前提本身就不成立了。\n在这种情况下，KIZAMI **只扣除到刚好落在基准上为止**\n(不会把实际劳动时间削减到基准以下)。在6小时5分钟的例子中，\n只扣除5分钟使其正好为6小时，不会再进一步削减。\n\n另外，如果扣除后正好落在基准上，则照常全额扣除。\n从9点待到18点共9小时，扣除60分钟后剩余正好8小时，\n但这正是\"8小时工作+60分钟午休\"这一最常见的工作方式本身，\n因此会照此记录。\n\n## 与同时给予原则、自由利用原则的关系\n\n关于休息时间，除了数量(时长)方面的规制(第34条第1款)之外，还有**同时给予原则**(第34条第2款。可通过劳资协定设置例外)和\n**自由利用原则**(第34条第3款)。KIZAMI 检测并自动扣除的，仅限于能够从打卡数据\n机械判定的时长，休息是否同时给予、是否能够自由利用则不在检测范围内。",
      companyExample: "本公司启用了休息时间的自动扣除(超过6小时为45分钟、超过8小时为60分钟)。\n因业务原因未能休息的日子，请于当日提出撤销申请并向所属主管报告。",
    },
    "attendance.day-boundary": {
      key: "attendance.day-boundary",
      audience: ["employee","admin"],
      origin: "product",
      summary: "日界是\"1天\"起算时刻的设置。深夜工作等跨日的勤务，以日界为分界确定归属于哪一个考勤日。",
      body: "# 日界(一天的起算时刻)\n\n日界是决定考勤上的\"1天\"从何时到何时的起算时刻。多数租户将日界设为\n凌晨0点，但在深夜工作较多的职场，也可以设置为凌晨5点等其他时刻。\n\n## 对跨日勤务的影响\n\n早于日界时刻的打卡视为前一天的勤务，日界之后的打卡视为当天的勤务。\n例如将日界设置为凌晨5点时，即使从凌晨1点开始工作、早上6点下班打卡，\n上班打卡和下班打卡也都会作为同一个\"勤务开始日\"的考勤进行汇总(即使跨过了\n日界的凌晨5点也不会被分割)。\n\n日界的设置会影响月度汇总、弹性工时收支、36协定(36協定，依据《劳动基准法》第36条签订的劳资协定)\n提醒等所有以日为单位进行的汇总。更改设置后，此后产生的考勤的日期归属方式将随之改变。",
      companyExample: "本公司的日界为凌晨5点(因为有部分部门深夜工作较多)。\n在凌晨5点之前结束的部分，将作为前一天的勤务进行汇总。",
    },
    "attendance.fixed-overtime": {
      key: "attendance.fixed-overtime",
      audience: ["employee","admin"],
      origin: "law",
      basis: "《劳动基准法》第32条第1款、第2款，第37条第1款(加算工资)，昭和63年基発第1号(周的起算)",
      summary: "固定工作时间制的法定时间外劳动，先确定每日超过8小时的部分，再加上该周法定时间内劳动超过每周40小时的部分。不按此顺序计算，就会把同一段劳动重复计算两次。",
      body: "# 固定工作时间制下加班的计算方法\n\n法定时间外劳动要按**每日**和**每周**两方面判定(《劳动基准法》第32条)。\n\n## 判定的顺序\n\n1. **每日的判定** — 当天的实际劳动时间减去8小时后的部分，即为当天的法定时间外劳动\n2. **每周的判定** — 将第1步中未计为加班的部分(法定时间内劳动)从周初开始累加，\n   超过40小时的部分计入法定时间外劳动\n\n**这个顺序很重要。** 如果先按周判定，就会把已经作为每日超过8小时而计为加班的劳动\n再次计入周的汇总，从而把同一段劳动计算两次。\n\n### 例:每周6天、每天工作7小时的情况\n\n各日均在8小时以内，因此第1步的每日判定不会产生加班。\n另一方面，周合计为42小时，因此超过40小时的**2小时**是每周的法定时间外劳动。\n\n### 例:每周5天、其中仅1天工作10小时的情况\n\n在工作10小时的那天产生**2小时**的每日法定时间外劳动。剩余的该周法定时间内劳动为\n8小时 × 4天 + 8小时 = 正好40小时，因此每周判定不会追加。合计为2小时。\n\n## 周的起算日\n\n要判定每周40小时，就需要有周的划分。就业规则中没有规定时，\n原则上以**星期日起算**(昭和63年基発第1号，即1988年基发第1号通达)。KIZAMI 中可按公司分别设置。\n\n## 即使是特例措置対象事業場(适用特例措施的事业场所)，每日8小时也不变\n\n商业、电影戏剧业、保健卫生业、接待娱乐业中经常使用劳动者不满10人的事业场所，\n其每周法定劳动时间放宽为44小时(《劳动基准法》第40条、《劳动基准法施行规则》第25条之2)。\n**放宽的只是周，每日8小时不变。**\n\n## 跨月的周的处理(KIZAMI 的规格)\n\n对于跨月的周，KIZAMI **仅以处于该月期间内的日子**判定每周40小时。\n上月的部分不予结转。\n\n这是优先保证已结算月份的数字事后不再变动的规格。因此在月初所在的那一周，\n每周的法定时间外劳动可能会显示得比实际少。如果存在跨越月初的长时间劳动，\n请一并确认月度一览中按日显示的实际劳动时间。",
      companyExample: "加班(法定时间外劳动)实行事前申请制。请在获得所属主管批准后进行。\n本公司周的起算日为星期日(就业规则第○条)。",
    },
    "attendance.flex-frame": {
      key: "attendance.flex-frame",
      audience: ["employee","admin"],
      origin: "law",
      basis: "《劳动基准法》第32条、第32条之3(弹性工作时间制的结算期间)",
      summary: "每月的总时长上限(総枠)由\"每周法定劳动时间 × 该月历日数 ÷ 7\"确定。实绩超出该上限的部分即为加班(法定时间外劳动)。",
      body: "# 弹性工作时间制的总时长上限\n\n在弹性工作时间制下，不是按每一天，而是以**结算期间(在本设置中为1个月)的合计**\n来判断劳动时间。该期间应当工作的时间上限称为\"総枠\"(结算期间总时长上限)。\n\n```\n总时长上限 = 每周法定劳动时间 × 该月历日数 ÷ 7\n```\n\n每周法定劳动时间原则上为40小时。作为例外，商业、电影戏剧业、保健卫生业、接待娱乐业中\n经常使用劳动者不满10人的事业场所([特例措置対象事業場](./tenant-special-provision))为44小时。\n\n| 月的天数 | 每周40小时的情况 | 每周44小时的情况 |\n| --- | --- | --- |\n| 30天 | 171小时25分钟 | 188小时34分钟 |\n| 31天 | 177小时8分钟 | 194小时51分钟 |\n\n实绩超出总上限的部分为**加班**，低于总上限的部分为**不足**。在 KIZAMI 的月度画面中\n显示为\"弹性工时收支\"。\n\n## 休年假当天的处理\n\n取得年度带薪休假的当天，视为已工作而计入实绩(全天则按约定劳动时间计，半天则按其一半计，\n按小时则按该时数计)。不会因为休了带薪假而使不足增加。",
    },
    "attendance.late-night": {
      key: "attendance.late-night",
      audience: ["employee","admin"],
      origin: "law",
      basis: "《劳动基准法》第37条第4款",
      summary: "22点至次日5点的劳动作为深夜劳动，属于25%以上加算工资的对象。与加班(法定时间外劳动)重叠时，加算率将合并计算。",
      body: "# 深夜劳动(22点至次日5点)的加算\n\n在**下午10点至次日凌晨5点**之间工作的时间视为深夜劳动，除通常工资外，\n还属于**25%以上**加算工资的对象(《劳动基准法》第37条第4款)。\n\n## 重叠时合并计算\n\n深夜劳动有时会与加班或休息日劳动同时发生。这种情况下，加算率将**合并计算**。\n\n| 组合 | 加算率参考 |\n| --- | --- |\n| 仅深夜劳动 | 25%以上 |\n| 加班 + 深夜劳动 | 50%以上(25%+25%) |\n| 法定休息日劳动 + 深夜劳动 | 60%以上(35%+25%) |\n\n## KIZAMI 的处理范围\n\nKIZAMI 会根据打卡记录，将属于深夜时段(22点至次日5点)的时长区分出来并汇总。\n实际加算工资金额的计算与支付，请依据汇总结果在工资计算一侧进行。",
    },
    "attendance.legal-holiday": {
      key: "attendance.legal-holiday",
      audience: ["employee","admin"],
      origin: "law",
      basis: "《劳动基准法》第35条、第37条第1款",
      summary: "法定休息日是每周至少1天(或每4周4天)的休息日。它与公司规定的约定休息日是不同的概念，只有在法定休息日的劳动才属于35%以上加算(休息日劳动)的对象。",
      body: "# 法定休息日与约定休息日的区别\n\n**法定休息日**是《劳动基准法》第35条为雇主设定的最低限度休息日，必须给予\n**每周至少1天**或**每4周至少4天**这两者之一。\n\n**约定休息日**是公司在就业规则等中规定的其他休息日(例如所谓\"双休\"中的一天)。\n它是公司在超出法律最低标准之外任意设立的，KIZAMI 中会将这两者区分处理。\n\n## 产生加算工资的只有法定休息日劳动\n\n| 休息日的种类 | 在该日工作的情况 |\n| --- | --- |\n| 法定休息日 | 作为休息日劳动，加算**35%以上**(《劳动基准法》第37条第1款) |\n| 约定休息日(法定休息日以外) | 不附加休息日劳动的加算。但如果该周劳动时间超过每周40小时，则作为加班加算25%以上 |\n\n人们常误以为\"只要在休息的日子工作就一律加35%\"，但产生35%加算的只有在法定休息日\n工作的情况。约定休息日的劳动不作为法定休息日劳动，而是作为加班(法定时间外劳动)处理。",
    },
    "attendance.minute-unit": {
      key: "attendance.minute-unit",
      audience: ["employee","admin"],
      origin: "law",
      basis: "《劳动基准法》第24条、第37条，昭63.3.14基発150号",
      summary: "劳动时间原则上应按日以1分钟为单位掌握。对劳动者不利的舍去处理，有可能被认定为违反工资全额支付(《劳动基准法》第24条)和加算工资(《劳动基准法》第37条)的规定。",
      body: "# 劳动时间的尾数处理(以1分钟为单位)\n\n劳动时间原则上应以**1分钟为单位**计算每日的实绩。像\"不满15分钟舍去\"\"不满30分钟舍去\"\n那样，把时间取整得短于实际工作时间从而减少工资的做法，有可能被认定为违反《劳动基准法》\n第24条(工资全额支付)或第37条(加算工资的支付)。\n\n## 唯一的例外: 对1个月合计的尾数处理\n\n虽然不能对每日的劳动时间本身取整，但仅限于**1个月的加班(法定时间外劳动)、休息日劳动、\n深夜劳动的合计**产生不满1小时的尾数时，允许采取不满30分钟舍去、30分钟以上进位的处理\n(昭63.3.14基発150号，即1988年3月14日基发第150号通达)。\n\n| 对象 | 尾数处理 |\n| --- | --- |\n| 每日的劳动时间 | 不可舍去(以1分钟为单位计算) |\n| 1个月的加班等合计 | 可以不满30分钟舍去、30分钟以上进位 |\n\n人们常误以为\"每日的打卡记录可以取整\"，但获得认可的只有针对月度合计的处理。",
    },
    "attendance.warnings": {
      key: "attendance.warnings",
      audience: ["employee","admin"],
      origin: "product",
      summary: "打卡记录不完整时，KIZAMI 会对缺失或矛盾的部分作保守解释。没有对应打卡的区间不计入汇总，前后不一致的打卡记录将被作废。",
      body: "# 打卡记录不完整时的处理\n\n由于忘记打卡或误操作，上下班或休息的打卡记录有时会不齐全。KIZAMI 对这类情况\n采取**保守解释**。\n\n## 采取保守解释的理由\n\n劳动时间需要正确记录\"实际工作过的时间\"。如果用推测填补缺失打卡的区间并计为劳动时间，\n就有可能记录出多于(或少于)实际情况的劳动时间。为了不把没有确证的区间捏造成劳动时间，\nKIZAMI 采取**不把缺失的信息计入汇总**的方针。如果与实际劳动时间不符，\n请通过更正申请补上正确的打卡记录。\n\n## 主要情形\n\n| 情况 | KIZAMI 的处理 |\n| --- | --- |\n| 没有下班打卡 | 将该勤务区间从汇总中排除(不计为工作过的时间) |\n| 勤务中存在重复的上班打卡 | 使之后重复的上班打卡失效 |\n| 未上班状态下的下班打卡 | 使该下班打卡失效 |\n| 勤务时间外的休息打卡 | 使该休息打卡失效 |\n| 休息中存在重复的休息开始打卡 | 使之后重复的休息开始打卡失效 |\n| 没有对应休息开始的休息结束打卡 | 使该休息结束打卡失效 |\n| 休息中存在下班打卡 | 视为结束休息后下班 |\n\n这些会显示在月度画面的警告列中。如果与实际劳动时间不同，请从该日的\"更正\"\n提出正确的打卡申请。",
    },
    "attendance.work-system": {
      key: "attendance.work-system",
      audience: ["employee","admin"],
      origin: "law",
      basis: "《劳动基准法》第32条(劳动时间)、第32条之3(弹性工作时间制)",
      summary: "加班(法定时间外劳动)的含义会因工作时间制而不同。固定工作时间制下是超过每日8小时、每周40小时的部分，弹性工作时间制下是超过结算期间(1个月)总时长上限的部分。",
      body: "# 工作时间制与\"时间外\"的含义\n\n同样是\"一天工作了10小时\"，是否构成加班会因所适用的工作时间制而不同。\n\n## 固定工作时间制\n\n设有**每日8小时、每周40小时**的上限，超过的部分当场即成为加班\n(《劳动基准法》第32条)。无需等到月末，当天即告确定。\n\n在约定劳动时间为7小时的公司工作了7小时30分钟时，这30分钟虽然超过了约定时间，\n但因在每日8小时以内，所以**不属于法定时间外劳动**。无需支付加算工资，\n但工作过的部分的工资当然要支付。KIZAMI 中会将其区分显示为\"法定时间内加班\"。\n\n## 弹性工作时间制\n\n将结算期间(KIZAMI 中为1个月)的**总时长上限(総枠)**与实绩相比较，超出的部分成为加班\n(《劳动基准法》第32条之3)。总时长上限由\"每周法定劳动时间 × 该月历日数 ÷ 7\"确定。\n\n**不存在以日为单位的加班这一概念。** 即使某一天工作了10小时，\n只要在当月的总时长上限之内，就不属于加班。由于该制度的宗旨在于由本人决定上下班时刻，\n因此采用了不按日设置上限的机制。\n\n也正因如此，适用弹性工作时间制者的月度一览中**不显示加班列**。\n准确地说，并非是隐藏不显示，而是当天尚未确定。\n月中的预计情况可以通过\"弹性工时收支\"确认。\n\n## 两种制度下都不变的内容\n\n以下内容无论适用何种工作时间制都同样处理。\n\n| | 内容 |\n| --- | --- |\n| 深夜劳动 | 22点至次日5点的劳动。加算25%以上(《劳动基准法》第37条第4款) |\n| 法定休息日劳动 | 每周1天的法定休息日的劳动。加算35%以上(《劳动基准法》第37条第1款) |\n| 休息时间 | 超过6小时为45分钟，超过8小时为60分钟(《劳动基准法》第34条) |\n| 年度带薪休假 | 授予天数、每年5天的取得义务(《劳动基准法》第39条) |",
      companyExample: "本公司原则上适用弹性工作时间制(结算期间1个月、无核心时间)。\n所适用的制度记载于劳动合同书中。如不清楚自己适用的制度，请咨询人事部。",
    },
    "closing.amend": {
      key: "closing.amend",
      audience: ["admin"],
      origin: "product",
      summary: "结算后更正是一种不解除当月确定状态、仅反映已批准的单笔变更的机制。反映之后，与结算时点最初数值之间的差异仍会持续显示。",
      body: "# 结算后更正\n\n对已结算月份提出的更正申请或休假申请获得批准时，即使不解除整月的确定状态，\n也可以仅反映**该1笔变更**，重新计算相应用户的汇总。该月仍保持已结算状态。\n\n## 与最初数值的差异会保留下来\n\n反映结算后更正之后，该月将变为\"结算后有更正\"的状态。结算时点的最初数值与\n反映更正后的当前数值都会被保留，月度画面上会持续显示**与最初数值的差异**。\n哪个区分变动了多少，事后均可追溯。\n\n## 与解除结算的区别\n\n| 操作 | 影响范围 | 月的状态 |\n| --- | --- | --- |\n| 解除结算 | 使整月可自由编辑 | 回到未确定状态 |\n| 结算后更正 | 仅反映已批准的1笔 | 保持已确定(记录差异) |\n\n由于无需重新打开该月，结算后更正适用于影响范围较小的变更。如果需要重新审视整月，\n请使用解除结算。",
    },
    "closing.execute": {
      key: "closing.execute",
      audience: ["employee","admin"],
      origin: "product",
      summary: "执行月度结算后，该月的考勤记录即告确定，此后的打卡与更正需要申请并获得批准。确定时点的数值将作为快照固定下来。",
      body: "# 月度结算\n\n结算是使对象月份的考勤记录\"确定\"的操作。结算时点的各区分合计、弹性工时收支等数值\n将作为**快照**固定下来，此后即使打卡或汇总方式发生变化，也不会追溯变动。\n\n## 结算后的处理\n\n- 结算后将无法追加、订正、取消打卡，如需变更则需要**更正申请及其批准**\n- 解除结算(解除确定)后，该月将重新回到可自由编辑的状态。解除需要另外的权限\n- 结算、解除、结算后更正的所有操作都会记录在审计日志中\n\n由于结算是工资计算等后续处理的起点，因此该机制是为了防止已结算月份的数字\n发生意料之外的变动。",
      companyExample: "每月5日结算上月部分。请在此之前完成更正申请。\n如需在结算后进行更正，请通过所属主管联系人事部。",
    },
    "closing.unlock": {
      key: "closing.unlock",
      audience: ["admin"],
      origin: "product",
      summary: "解除已确定的月度结算，使该月的考勤记录重新回到可更正的状态。解除、再次更正、再次结算的操作全部会记录到审计日志中。",
      body: "# 结算的解除\n\n解除月度结算后，已经确定的该月考勤记录将重新变为可修改状态。\n\n- 该操作需要「解除结算」权限\n- 解除已用于工资计算的月份时，请注意与导出目标之间的一致性\n- 由谁在何时解除会作为结算状态的历史保留下来，也可以从审计日志中确认",
    },
    "correction.flow": {
      key: "correction.flow",
      audience: ["employee","admin"],
      origin: "product",
      summary: "打卡记录无法直接编辑。新增、订正、撤销都必须作为更正申请提交，经过批准后才会反映到考勤记录中。包括批准、驳回、撤回在内的所有变更都会记录到审计日志中。",
      body: "# 打卡更正申请的流程\n\n打卡记录本身无法直接改写。若要新增、订正或撤销打卡记录，需要作为**更正申请**提交，\n只有在获得批准的结果下才会反映到考勤记录中。\n\n## 申请的种类\n\n- **新增**: 对忘记打卡的上下班、休息时间进行新登记的申请\n- **订正**: 变更既有打卡记录的时刻或种别的申请\n- **撤销**: 使既有打卡记录视为不存在的申请\n\n## 到批准为止的流程\n\n1. 本人(或拥有代理权限的负责人)附上理由提交申请(状态: 申请中)\n2. 拥有批准权限的负责人确认内容，予以批准或驳回\n3. 批准后反映到打卡记录中，并反映到月度汇总。被驳回的情况下不会反映\n4. 处于申请中的期间，本人也可以撤回\n\n对象月份已经结算的情况下，另外需要解除确定的权限才能批准。\n\n## 全部留存在审计日志中\n\n申请的提交、批准、驳回、撤回，包括何时由谁执行在内，全部会记录到审计日志中。\n批准者与申请者为同一人的情况(自我批准)，该情况也会作为记录留存下来。",
      companyExample: "申请请在对象日期的次一个工作日内提交。\n繁忙期(月末最后3个工作日)的批准有可能推迟到次一个工作日。",
    },
    "law.versioning": {
      key: "law.versioning",
      audience: ["admin"],
      origin: "product",
      summary: "法律修订会在到达事先登记的施行日时自动切换。过去期间的计算仍然沿用该期间当时有效的法令，不会发生变化。",
      body: "# 法律修订的自动切换\n\nKIZAMI 将《劳动基准法》等法令规则作为「带施行日的版本」进行管理。若在施行前事先登记将来的\n法律修订，那么在到达该施行日的瞬间会自动切换为新规则，并且会在租户档案画面上事先显示为\n预定适用的法律修订。\n\n## 过去的期间仍沿用当时的规则\n\n法律修订只会反映到施行日以后的期间。不仅是已经结算的月份，即使是尚未结算的过去月份，\n汇总所使用的法令规则也是**该期间当时有效的规则**。不会按最新规则对过去部分进行追溯重算。\n\n由此可以防止每次法律修订都导致过去的汇总结果发生变化(与已结算的数字产生出入)。",
    },
    "leave.grant": {
      key: "leave.grant",
      audience: ["employee","admin"],
      origin: "law",
      basis: "《劳动基准法》第39条第1款・第2款、第115条",
      summary: "年度带薪休假在入职后连续工作6个月且出勤达到全部劳动日的8成以上时授予10天，之后随工龄增加最多增至20天。已授予的休假自授予日起2年因时效消灭。",
      body: "# 年度带薪休假的法定授予天数与时效\n\n自雇用之日起**连续工作6个月**，且在此期间出勤达到全部劳动日的**8成以上**的劳动者，\n将获得年度带薪休假(《劳动基准法》第39条第1款)。之后，天数会随着工龄增加\n(同条第2款)。\n\n## 各工龄对应的授予天数(全职的情况)\n\n| 工龄 | 授予天数 |\n| --- | --- |\n| 6个月 | 10天 |\n| 1年6个月 | 11天 |\n| 2年6个月 | 12天 |\n| 3年6个月 | 14天 |\n| 4年6个月 | 16天 |\n| 5年6个月 | 18天 |\n| 6年6个月以后 | 20天 |\n\n无论哪个区间，条件都是在对象期间内出勤达到全部劳动日的8成以上。\n\n## 每周约定劳动日数较少的情况（比例授予）\n\n对于每周约定劳动时间不足30小时，且每周约定劳动日数在4日以下（以周以外的期间约定时，\n年间约定劳动日数在216日以下）的劳动者，适用与上表不同的**比例授予**天数表\n(《劳动基准法》第39条第3款、同法施行规则第24条之3)。\n\n| 每周约定劳动日数 | 6个月 | 1年6个月 | 2年6个月 | 3年6个月 | 4年6个月 | 5年6个月 | 6年6个月以后 |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| 4日 | 7天 | 8天 | 9天 | 10天 | 12天 | 13天 | 15天 |\n| 3日 | 5天 | 6天 | 6天 | 8天 | 9天 | 10天 | 11天 |\n| 2日 | 3天 | 4天 | 4天 | 5天 | 6天 | 6天 | 7天 |\n| 1日 | 1天 | 2天 | 2天 | 2天 | 3天 | 3天 | 3天 |\n\nKIZAMI 会根据每位成员的「年假授予区分」按此表计算天数。区分不会从每周约定劳动时间・\n日数自动判定，而是由**管理员依据就业规则・劳动合同进行设置**（成员管理界面）。\n未设置区分的成员按普通（每周5日以上）处理。\n\n此外，即使是比例授予，**只要单次授予天数达到10天以上，就属于年5日取得义务的对象**\n（如每周4日区分的3年6个月=10天）。\n\n## 时效为2年\n\n已授予的年度带薪休假自**授予日起2年**因时效而消灭(《劳动基准法》第115条)。上年度\n未使用的部分能结转到本年度的，仅限于这2年以内的部分。",
      companyExample: "本公司采取高于法定标准的做法，在入职当日提前授予5天。\n详情请确认就业规则第◯条。",
    },
    "leave.hourly": {
      key: "leave.hourly",
      audience: ["employee","admin"],
      origin: "law",
      basis: "《劳动基准法》第39条第4款、平21.5.29基発0529001号(2009年5月29日基发第0529001号通知)",
      summary: "只有在存在劳资协定的情况下才能按小时取得年度带薪休假，且上限为每年5天份。每天相当的小时数按约定劳动时间向上取整到1小时单位计算。",
      body: "# 按小时取得的年度带薪休假\n\n年度带薪休假原则上以1天为单位取得，但**仅限于签订了劳资协定的情况**，\n可以按小时取得。\n\n## 上限为每年5天份\n\n按小时可以取得的上限为**每年5天份**。这是法律上的上限，劳资协定中可以规定得比这个更少，\n但不能超过。\n\n「5天份」的小时数，按每天的约定劳动时间**向上取整到1小时单位**计算。\n\n| 约定劳动时间 | 每天相当 | 每年5天份 |\n| --- | --- | --- |\n| 8小时 | 8小时 | 40小时 |\n| 7小时30分 | **8小时**(向上取整) | 40小时 |\n| 7小时 | 7小时 | 35小时 |\n\n从上年度结转的年度带薪休假按小时取得时，也**计入本年度5天的额度**中\n计算。并不会因为是结转部分就另算额度。\n\n## 不能计入每年5天的取得义务\n\n按小时取得，不被认可为满足[每年5天的取得义务](./leave-mandatory-five-days)的取得方式。\n要满足该义务，需要以全天或半天的方式取得。",
      companyExample: "本公司可以按1小时为单位取得(依据劳资协定)。\n希望取得超过半天的情况，请使用半天休假。",
    },
    "leave.mandatory-five-days": {
      key: "leave.mandatory-five-days",
      audience: ["employee","admin"],
      origin: "law",
      basis: "《劳动基准法》第39条第7款・第8款(2019年4月1日施行)",
      summary: "被授予每年10天以上年度带薪休假的人，需要在授予日起1年以内取得5天。半天休假按0.5天计算，但按小时取得不计入。",
      body: "# 每年5天的取得义务\n\n被授予每年10天以上年度带薪休假的人，需要在**授予日起1年以内取得5天**。\n这既是劳动者的权利，同时也是课予公司的义务。\n\n## 计算方式需注意\n\n| 取得的单位 | 是否计入5天 |\n| --- | --- |\n| 全天 | 按1.0天计算 |\n| 半天(上午・下午) | **按0.5天计算** |\n| 按小时 | **不计入** |\n\n按小时取得的年度带薪休假，不被认可为满足这5天义务的取得方式。\n即使按小时取得了40小时，义务的履行仍然是0天。要满足该义务，\n需要以全天或半天的方式取得。\n\n## 期限\n\n期限是「授予日起1年后」。由于授予日因人而异(以入职日为基准的情况下)，\n期限也因人而异。可以在 KIZAMI 的带薪休假画面确认自己的期限和剩余天数。\n\n临近期限时会收到通知(90天前・30天前)。",
      companyExample: "取得计划请在每年4月底之前向所属主管申报。\n对于未使用天数仍剩余3天以上的人员，人事部门将在10月单独联系。",
    },
    "overtime.60h": {
      key: "overtime.60h",
      audience: ["employee","admin"],
      origin: "law",
      basis: "《劳动基准法》第37条第1款但书(2010年4月1日施行，中小企业自2023年4月1日起适用)",
      summary: "一个月内超过60小时的加班，超出部分的加算工资率为50%以上。中小企业曾有缓行期，但自2023年4月1日起已适用于所有企业。",
      body: "# 每月超过60小时加班的加算率\n\n一个月的加班(法定时间外劳动)**超过60小时**时，其**超出部分**的加算工资率\n为**50%以上**(《劳动基准法》第37条第1款但书)。\n\n## 60小时以内的部分不变\n\n变为50%的只是超过60小时的部分，60小时以内的部分仍然维持通常加班的加算率\n(25%以上)。并不是「每月超过60小时后全部按50%」。\n\n| 加班的区分 | 加算率 |\n| --- | --- |\n| 60小时以内 | 25%以上 |\n| 超过60小时的部分 | 50%以上 |\n\n## 中小企业的缓行期已经结束\n\n这项50%规则对大企业自2010年4月1日起适用，但对中小企业曾有缓行措施。\n自**2023年4月1日**起已对中小企业适用，目前无论企业规模如何\n都适用相同的规则。",
    },
    "permission.presets": {
      key: "permission.presets",
      audience: ["admin"],
      origin: "product",
      summary: "权限预设分配多个时会合并累加，批准、执行等操作类权限会自动包含对应的查看权限。不存在抵消特定权限的拒绝规则。",
      body: "# 权限预设的思路\n\n权限预设是将权限的开/关与适用范围(作用域)组合起来定义的分配单位。\n\n## 多个分配会合并累加\n\n给一名成员分配多个预设时，其可拥有的权限会**合并(相加)**。\n同一权限被分配了不同作用域时，范围较广的作用域生效。\n\n## 操作蕴含查看\n\n打开批准、执行、管理等操作类权限后，该操作所需范围内的查看权限\n会自动生效。例如打开「可以批准打卡更正申请」后，即使不另行打开对象范围内的\n更正申请、考勤记录的查看权限，也可以进行查看。\n\n## 不存在拒绝(deny)规则\n\nKIZAMI 的权限模型中，不存在明确抵消特定权限的「拒绝」规则。\n为了避免分配多个预设的结果导致意外授予过广的权限，分配时请确认\n各个预设实际打开的权限一览。",
    },
    "privacy.internal-terms-template": {
      key: "privacy.internal-terms-template",
      audience: ["employee","admin"],
      origin: "product",
      summary: "可以从「设置 > 个人信息」画面获取有关打卡的公司内部使用规约范本，其中包含准确打卡的义务、禁止代打卡等内容。",
      body: "# 有关打卡的公司内部使用规约范本\n\n汇总了准确打卡的义务、禁止代打卡、忘记打卡时的更正申请手续、违规打卡的处理的\n公司内部使用规约范本，可以从「设置 > 个人信息」画面获取。\n\n该范本可以直接作为就业规则的一部分，也可以作为附件向员工周知，\n请配合本公司的运用方式加以活用。若设置了指向就业规则的链接，\n范本末尾会自动附上相应的指引。",
      companyExample: "本规约作为就业规则第◯条(服务纪律)的一部分处理。违反时的处理依照就业规则的惩戒规定。",
    },
    "privacy.notice-template": {
      key: "privacy.notice-template",
      audience: ["employee","admin"],
      origin: "product",
      summary: "可以从「设置 > 个人信息」画面获取面向员工公布打卡记录、IP、UA、GPS坐标等个人信息的隐私通知范本。范本会根据当前的GPS设置与保存期限自动生成。",
      body: "# 面向员工的隐私通知范本\n\n打卡记录、IP地址、用户代理、GPS坐标(启用时)属于员工的个人信息。\n向员工公布这些信息的取得目的与保存期限的义务(《个人信息保护法》第17条、第18条、第21条)，\n承担者不是 KIZAMI 项目，而是**引入该系统的企业**。\n\nKIZAMI 会从「设置 > 个人信息」画面自动生成反映当前租户设置(GPS的启用/禁用、保留期限)的\n隐私通知范本。GPS被禁用时，不会显示与位置信息有关的项目。\n\n## 使用方法\n\n1. 在「设置 > 个人信息」画面确认生成的文本\n2. 结合本公司的实际情况(公开、更正的请求窗口等)进行审阅修改\n3. 向员工周知(张贴、内网刊登、附于劳动合同书等，方法由本公司自行选择)\n\n生成的文本终究只是范本，并非法律建议。若对内容有疑虑，\n请向社会保险劳务士(社会保険労務士)、律师等专业人士确认。",
      companyExample: "本公司于2026年8月依据该范本制作了隐私通知，并刊登在内网的「通知」栏目中。\n修订时请在此处补记刊登日期。",
    },
    "privacy.retention-after-leaving": {
      key: "privacy.retention-after-leaving",
      audience: ["employee","admin"],
      origin: "law",
      basis: "《劳动基准法》第109条、附则第143条第2款，《个人信息保护法》第22条",
      summary: "即使离职，考勤记录也由法律规定了保存义务(原则5年，根据过渡措施暂时为3年)。该期限届满后，姓名、电子邮件地址等能够识别个人的信息会被消除，但考勤记录本身仍会保留。",
      body: "# 离职后记录的保存与消除\n\n即使离职，考勤记录也不会立即消失。这是因为**法律规定了保存义务**。\n\n## 两部法律指向相反的方向\n\n| 法律 | 所要求的内容 |\n| --- | --- |\n| 《劳动基准法》第109条 | **必须保存**工资台账、出勤簿等记录(原则5年。根据附则第143条第2款的过渡措施，暂时为3年) |\n| 《个人信息保护法》第22条 | 对于已无使用必要的个人数据，**必须努力不迟延地予以消除** |\n\n对于离职者，这两者正面冲突。消除记录会违反《劳动基准法》，\n而继续保留则违反《个人信息保护法》的努力义务。\n\n既然保存义务是「必须」(义务)，而消除是「必须努力」(努力义务)，\n那么**在保存期限届满之前予以保留**才是正确的顺序。\n\n## 保存期限的起算日\n\n《劳动基准法》第109条的保存期限自「最后记载之日」起算。就离职者而言，最后一条考勤记录\n即为该日。KIZAMI 将**办理离职处理之日**作为起算日。由于离职处理在最终出勤日之后办理，\n这种处理只可能比实际的起算日**更靠后**，而不会提前，因此不会侵蚀义务期间。\n\n## 期限届满后会发生什么\n\n保留期限届满后，管理员即可消除离职者的个人数据。\n此时消失的内容与保留的内容如下。\n\n| 对象 | 处理 |\n| --- | --- |\n| 姓名、电子邮件地址 | 替换为无法识别个人的表述 |\n| 密码、双因素认证、登录信息 | 删除 |\n| 通知设置、终端信息(IP地址、浏览器信息、位置信息) | 删除 |\n| 考勤记录(打卡时刻、汇总结果、已结算月份的数字) | **保留**(因为存在保存义务) |\n| 审计日志 | **保留**(不作改动。仅将其中显示的姓名匿名化) |\n\n也就是说，这并不是「消除记录」，而是**从记录中去除「这是谁的记录」这一信息**的操作。\n由于考勤记录的行本身不会消失，过去已结算月份的汇总值在消除前后不会发生变化。\n\n该操作**无法撤销**。离职后如希望获取本人记录的公开，\n请在保留期限届满之前联系公司的窗口。\n\n## 保留期限由公司选择\n\n采用3年(过渡措施)还是5年(原则)由公司决定。KIZAMI 的默认值为**5年**\n—— 因为过渡措施终将结束，届时若仍维持3年就无法满足保存义务。",
      companyExample: "本公司将保留期限定为3年(过渡措施)。\n离职后如希望获取本人记录的公开，请在该期限内联系人事部。",
    },
    "tenant.special-provision": {
      key: "tenant.special-provision",
      audience: ["admin"],
      origin: "law",
      basis: "《劳动基准法》第40条、《劳动基准法施行规则》第25条之2",
      summary: "商业、电影戏剧业、保健卫生业、接待娱乐业中经常使用劳动者不满10人的事业场所，每周的法定劳动时间为44小时。这不是过去的过渡措施，而是现行制度。",
      body: "# 特例措置対象事業場(适用特例措施的事业场所，每周44小时)\n\n每周的法定劳动时间原则上为40小时，但**同时**满足以下两个条件的事业场所则为**44小时**。\n\n1. 行业属于 **商业、电影戏剧业、保健卫生业、接待娱乐业** 之一\n2. 经常使用的劳动者 **不满10人**\n\n这是在1997年全面实施每周40小时制时设立的，并不是过去的过渡措施，\n而是**现在仍然有效的制度**。\n\n## 对汇总的影响\n\n由于每周的法定劳动时间用于[弹性工作时间制的总时长上限](./attendance-flex-frame)的计算，\n是否符合条件会改变当月的总上限。\n\n| 月的天数 | 每周40小时 | 每周44小时 |\n| --- | --- | --- |\n| 30天 | 171小时25分 | 188小时34分 |\n| 31天 | 177小时8分 | 194小时51分 |\n\n30天的月份大约会产生17小时的差异。**符合条件却未进行设置的话，原本不属于加班的劳动\n会被计入加班。**\n\n## 设置与重新审视\n\n在「设置 → 租户档案」中切换。判定以事业场所为单位，因此\n**在员工人数达到10人以上的时点起即不再符合条件**。人数有增减时，\n请重新审视设置(KIZAMI 不会根据人数自动判定)。",
      companyExample: "本事业场所为零售业、员工7名，因此属于适用特例措施的事业场所(截至2026年4月)。\n员工人数达到10名以上时，请尽快重新审视设置。",
    },
  },
};

/**
 * ロケールごとの「日本語にはあるが訳文が無い」キー一覧(生成時点のスナップショット)。
 * すべて空配列であることをテストで保証する。空でない = その言語のヘルプは日本語のまま出る。
 */
export const HELP_MISSING_KEYS: Record<HelpLocale, HelpKey[]> = {
  ja: [],
  en: [],
  ko: [],
  zh: [],
};

/**
 * 訳文の位置づけについての注記(1箇所のみ・ファイルごとの免責は書かない方針)。
 * 日本語(HELP_SOURCE_LOCALE)は空文字 — 正文そのものなので断り書きの対象にならない。
 */
export const HELP_TRANSLATION_NOTICE: Record<HelpLocale, string> = {
  ja: "",
  en: "This translation is provided for reference. The Japanese text and Japanese law are authoritative.",
  ko: "이 번역은 참고용입니다. 정본은 일본어 원문 및 일본 법령입니다.",
  zh: "本译文仅供参考。以日文原文及日本法律为准。",
};

/** HELP の全キー(定義順=キーのソート順)。 */
export const HELP_KEYS: HelpKey[] = Object.keys(HELP) as HelpKey[];
