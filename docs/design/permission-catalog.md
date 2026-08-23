# KIZAMI 権限カタログ

- ステータス: 実装済み(2026-08-22)。残るレビュー論点は文末参照
- **機械可読な正は `packages/authz/src/catalog.ts` の `PERMISSION_CATALOG`**。この文書は設計意図と根拠を説明するもので、権限キー・スコープ・危険フラグの実体はコード側が正。`GET /presets/catalog` がそれを返し、権限プリセット編集UIのチェックボックスを描画する
- 対応要件: [要件定義書](../requirements.md) §4 / データモデルとの関係: [v0.1 データモデル設計](./v01-data-model.md)(§4 権限モデル、§12-1 未決事項に対応)
- 前提:
  - **セルフサービス権限**(自分の打刻・自分の修正/休暇申請の起票・自分の記録閲覧)は全ユーザーが常時保持する固定権限であり、プリセットのON/OFF対象外のため本カタログには含めない。
  - **denyは存在しない**。プリセットに含まれる権限は加算(union)されるのみ。
  - **操作は閲覧を含意する**。承認・実行・管理系の権限をONにすると、対応する閲覧権限は自動的に有効になる(UI上も明示)。
  - スコープ表記: `本人のみ` / `自部署` / `自部署+配下部署` / `テナント全体`。項目ごとに意味のある選択肢のみを列挙する(本人のみが無意味な項目には出さない)。
  - スコープの機械可読キー(2026-08-21確定、DB の grants JSON で使用): `self`(本人のみ)/ `department`(自部署)/ `department_and_descendants`(自部署+配下部署)/ `tenant`(テナント全体)。
  - 「危険フラグ」は §4 が言う「編集UI上で影響範囲の説明を添えて表示すべき権限」を指す。§10の文脈ヒント(操作時の都度のツールチップ)とは対象が重なるが別軸であり、ここでは**権限プリセット編集画面での重点表示対象**という意味で付与している。

## 1. 業務タスク単位の権限カタログ(31項目。2026-08-23 に shift.manage を追加)

### 1.1 打刻(代理操作)

| キー | 日本語ラベル | 説明 | 適用スコープ | 含意される閲覧権限 | 危険 |
|---|---|---|---|---|---|
| `attendance.punch.proxy` | 他者の打刻を代理で記録できる | IC障害・打刻忘れ等の際に、他のメンバーに代わって出退勤・休憩の打刻を登録できる | 自部署 / 自部署+配下部署 / テナント全体 | 対象範囲の勤怠記録閲覧(`attendance.record.view`相当) | いいえ |

### 1.2 修正申請・承認

| キー | 日本語ラベル | 説明 | 適用スコープ | 含意される閲覧権限 | 危険 |
|---|---|---|---|---|---|
| `attendance.correction.request_for_others` | 他者に代わって修正申請を起票できる | 本人が申請できない事情がある場合に、担当者が本人に代わって打刻修正申請を作成できる | 自部署 / 自部署+配下部署 / テナント全体 | 対象範囲の勤怠記録閲覧・修正申請閲覧 | いいえ |
| `attendance.correction.approve` | 勤怠の修正系申請を承認できる | メンバーから提出された打刻修正申請・休憩の自動控除打ち消し申請を承認し、勤怠記録に反映する | 自部署 / 自部署+配下部署 / テナント全体 | 修正申請閲覧・対象範囲の勤怠記録閲覧 | いいえ |
| `attendance.correction.view_all` | 他者の修正申請状況を閲覧できる | 承認権限がなくても、修正申請の提出・承認状況を確認できる(人事の状況把握等) | 自部署 / 自部署+配下部署 / テナント全体 | ― | いいえ |

### 1.3 勤怠記録閲覧

| キー | 日本語ラベル | 説明 | 適用スコープ | 含意される閲覧権限 | 危険 |
|---|---|---|---|---|---|
| `attendance.record.view` | 他者の勤怠記録(日次・月次)を閲覧できる | 自分以外のメンバーの日次・月次の勤怠記録・集計結果を確認できる | 自部署 / 自部署+配下部署 / テナント全体 | ― | いいえ |
| `shift.manage` | シフト表を作成・確定できる | メンバーのシフト表(勤務日・勤務時間・休日)を作成し、確定後の変更履歴を残しながら修正できる(変形労働時間制の「事前特定」に相当。2026-08-23 v0.7 追加) | 自部署 / 自部署+配下部署 / テナント全体 | 対象範囲の勤怠記録閲覧 | いいえ |

### 1.4 休暇(申請・承認・付与管理)

| キー | 日本語ラベル | 説明 | 適用スコープ | 含意される閲覧権限 | 危険 |
|---|---|---|---|---|---|
| `leave.request.approve` | 休暇申請を承認できる | メンバーから提出された休暇申請を承認できる | 自部署 / 自部署+配下部署 / テナント全体 | 休暇申請閲覧・対象範囲の勤怠記録閲覧 | いいえ |
| `leave.request.view_all` | 他者の休暇申請状況を閲覧できる | 承認権限がなくても、休暇申請の提出・承認状況を確認できる | 自部署 / 自部署+配下部署 / テナント全体 | ― | いいえ |
| `leave.grant.manage` | 有給休暇の付与・残日数を管理できる | 法定基準日方式等に基づく有給付与の実行、残日数の個別調整ができる | 自部署+配下部署 / テナント全体 | 有給残日数閲覧(`leave.balance.view`相当) | **はい** |
| `leave.balance.view` | 他者の有給残日数を閲覧できる | 付与権限がなくても、メンバーの有給残日数・取得状況を閲覧できる | 自部署 / 自部署+配下部署 / テナント全体 | ― | いいえ |
| `leave.mandatory_five_days.view` | 年5日取得義務の状況を閲覧できる | 対象者ごとの年5日取得義務の充足状況・未達アラートを確認できる | 自部署 / 自部署+配下部署 / テナント全体 | ― | いいえ |

### 1.5 締め

| キー | 日本語ラベル | 説明 | 適用スコープ | 含意される閲覧権限 | 危険 |
|---|---|---|---|---|---|
| `closing.execute` | 月次締めを実行できる | 対象月の勤怠を確定させ、以後の直接的な変更をロックする | 自部署+配下部署 / テナント全体 | 締め状態閲覧・対象範囲の勤怠記録閲覧 | **はい** |
| `closing.unlock` | 締めを解除できる | 確定済みの月次締めを再オープンし、遡及修正を可能にする | 自部署+配下部署 / テナント全体 | 締め状態閲覧・監査ログ閲覧(締め関連) | **はい**(要件§4で専用権限として明記) |
| `closing.view` | 締め状態・履歴を閲覧できる | 各月の締め状態(未締め/締め済み)と解除履歴を確認できる | 自部署 / 自部署+配下部署 / テナント全体 | ― | いいえ |

### 1.6 エクスポート

| キー | 日本語ラベル | 説明 | 適用スコープ | 含意される閲覧権限 | 危険 |
|---|---|---|---|---|---|
| `export.attendance.run` | 勤怠データをCSV/API出力できる | 区分別時間数を含む勤怠データをCSVまたは外部連携用に出力できる | 自部署 / 自部署+配下部署 / テナント全体 | 対象範囲の勤怠記録閲覧 | **はい** |

### 1.7 36協定アラート

| キー | 日本語ラベル | 説明 | 適用スコープ | 含意される閲覧権限 | 危険 |
|---|---|---|---|---|---|
| `alert.labor_limit.view` | 36協定アラート(時間外超過状況)を閲覧できる | 時間外労働の月45h等の閾値に対する実績・超過見込みを確認できる | 自部署 / 自部署+配下部署 / テナント全体 | ― | いいえ |
| `alert.labor_limit.configure` | 36協定アラートの閾値・通知先を設定できる | 法定上限に対するアラート閾値や通知先チャネルを設定できる | テナント全体のみ | アラート閲覧(`alert.labor_limit.view`) | **はい** |

### 1.8 メンバー管理

| キー | 日本語ラベル | 説明 | 適用スコープ | 含意される閲覧権限 | 危険 |
|---|---|---|---|---|---|
| `member.invite` | メンバーを招待・追加できる | 新しいメンバーをテナントに招待し、アカウントを作成できる | 自部署 / 自部署+配下部署 / テナント全体 | メンバー一覧閲覧 | いいえ |
| `member.profile.edit` | メンバーの基本情報を編集できる | 氏名・所属部署・雇用形態などメンバーの基本情報を編集できる | 自部署 / 自部署+配下部署 / テナント全体 | メンバー一覧閲覧 | いいえ |
| `member.deactivate` | メンバーを無効化(退職処理)できる | 退職・休職等によりメンバーのアカウントを無効化し、ログインを停止できる | 自部署 / 自部署+配下部署 / テナント全体 | メンバー一覧閲覧 | **はい** |
| `member.view` | メンバー一覧・詳細を閲覧できる | メンバーの一覧および詳細プロフィールを閲覧できる | 自部署 / 自部署+配下部署 / テナント全体 | ― | いいえ |

### 1.9 部署管理

| キー | 日本語ラベル | 説明 | 適用スコープ | 含意される閲覧権限 | 危険 |
|---|---|---|---|---|---|
| `department.manage` | 部署ツリーを管理できる | 部署の作成・編集・異動(部署ツリーの構成変更)を行える | 自部署+配下部署 / テナント全体 | 部署ツリー閲覧 | いいえ(要検討: レビュー論点参照) |

### 1.10 テナント設定

| キー | 日本語ラベル | 説明 | 適用スコープ | 含意される閲覧権限 | 危険 |
|---|---|---|---|---|---|
| `tenant_settings.calendar.manage` | 日界・法定休日カレンダーを設定できる | 1日の起算時刻(日界)や法定休日の曜日・暦日指定を設定できる | テナント全体のみ | テナント設定閲覧 | いいえ |
| `tenant_settings.flex.manage` | フレックスタイム設定を管理できる | 清算期間などフレックス勤務設定を管理できる | テナント全体のみ | テナント設定閲覧 | いいえ |
| `tenant_settings.gps.manage` | GPS打刻の設定を管理できる | GPS座標取得のopt-in有効化や保持期間を設定できる | テナント全体のみ | テナント設定閲覧 | **はい**(従業員のプライバシーに影響。有効化は従業員への明示が必須) |
| `tenant_settings.auto_deduction.manage` | 休憩自動控除ルールを設定できる | 6時間超45分・8時間超1時間等の休憩自動控除ルールを設定できる | テナント全体のみ | テナント設定閲覧 | **はい**(§10で「影響が画面の外に及ぶ操作」として明記) |

### 1.11 通知設定

| キー | 日本語ラベル | 説明 | 適用スコープ | 含意される閲覧権限 | 危険 |
|---|---|---|---|---|---|
| `notification.settings.manage` | 通知チャネルを設定できる | メール(SMTP)・Slack/Discord Webhook・Web Push等の通知チャネルを設定できる | テナント全体のみ | テナント設定閲覧 | いいえ |

### 1.12 権限管理

| キー | 日本語ラベル | 説明 | 適用スコープ | 含意される閲覧権限 | 危険 |
|---|---|---|---|---|---|
| `permission.preset.manage` | 権限プリセットを編集できる | 権限プリセットの内容(権限のON/OFFとスコープの組合せ)を新規作成・編集できる | テナント全体のみ | 権限プリセット閲覧 | **はい**(要件§4で明記) |
| `permission.assignment.manage` | メンバーへの権限プリセット割当を変更できる | メンバーに対する権限プリセットの割当・解除を行える | 自部署 / 自部署+配下部署 / テナント全体 | 権限プリセット閲覧・対象メンバーの実効権限ビュー閲覧 | **はい**(要件§4で明記。自己昇格防止ロジックの対象) |

### 1.13 監査ログ

| キー | 日本語ラベル | 説明 | 適用スコープ | 含意される閲覧権限 | 危険 |
|---|---|---|---|---|---|
| `audit_log.view` | 監査ログを閲覧できる | 打刻・修正・承認・締め・権限変更などの不可変監査ログを閲覧できる | 自部署 / 自部署+配下部署 / テナント全体 | ― | **はい**(要件§4で明記) |

### 1.14 APIキー/MCP接続管理

| キー | 日本語ラベル | 説明 | 適用スコープ | 含意される閲覧権限 | 危険 |
|---|---|---|---|---|---|
| `api_key.manage` | APIキー/MCP接続を管理できる | 公開打刻API・MCPサーバー接続用のAPIキーの発行・失効を行える | テナント全体のみ | APIキー一覧閲覧 | **はい**(発行された鍵は保有者の権限で操作可能になるためセキュリティ影響大) |

---

## 2. 内部モデル: リソース×操作

### 2.1 リソース一覧

| リソースキー | 説明 |
|---|---|
| `punch` | 打刻の個別レコード(出勤・退勤・休憩入/戻)。1分単位・不変 |
| `attendance_day` | 日次勤怠の集計結果(区分別時間数等)。`punch`/`correction_request`/`leave_request`から導出される派生データ |
| `correction_request` | 打刻修正申請(起票〜承認のワークフロー) |
| `leave_request` | 休暇申請(起票〜承認のワークフロー) |
| `leave_grant` | 有給休暇の付与・残日数レコード |
| `closing` | 月次締めの状態と履歴 |
| `export` | CSV/API出力ジョブ |
| `alert_config` | 36協定アラートの閾値設定、および算出済み超過状況の参照(v0.1は設定と状況表示を同一リソースとして扱う) |
| `member` | メンバー(従業員)アカウント |
| `department` | 部署ツリーのノード |
| `tenant_settings` | テナント単位の各種設定(日界・法定休日・フレックス・GPS・自動控除・通知チャネル等。`target`属性で設定領域を区別) |
| `permission_preset` | 権限プリセットの定義とメンバーへの割当 |
| `audit_log` | 不可変監査ログ |
| `api_key` | 公開打刻API/MCP接続用のAPIキー |

### 2.2 リソース×操作マトリクス

| リソース | read | create | update | delete | approve | execute | unlock | assign | revoke |
|---|---|---|---|---|---|---|---|---|---|
| `punch` | ✓ | ✓ | | | | | | | |
| `attendance_day` | ✓ | | | | | | | | |
| `correction_request` | ✓ | ✓ | | | ✓ | | | | |
| `leave_request` | ✓ | ✓ | | | ✓ | | | | |
| `leave_grant` | ✓ | ✓ | ✓ | | | | | | |
| `closing` | ✓ | | | | | ✓ | ✓ | | |
| `export` | | | | | | ✓ | | | |
| `alert_config` | ✓ | | ✓ | | | | | | |
| `member` | ✓ | ✓ | ✓ | ✓ | | | | | |
| `department` | ✓ | ✓ | ✓ | ✓ | | | | | |
| `tenant_settings` | ✓ | | ✓ | | | | | | |
| `permission_preset` | ✓ | ✓ | ✓ | | | | | ✓ | |
| `audit_log` | ✓ | | | | | | | | |
| `api_key` | ✓ | ✓ | | | | | | | ✓ |

`attendance_day`は集計エンジンによる自動生成のみで、直接のcreate/update操作は持たない(修正は`correction_request`経由)。`punch`はupdate/deleteを持たず、事後修正は必ず`correction_request`を通す(§4の「本人直接編集不可」原則をリソース設計に反映)。

## 3. 業務タスク権限 → 内部権限 展開対応表

| 業務タスク権限キー | 内部権限展開(resource:operation) |
|---|---|
| `attendance.punch.proxy` | `punch:create`(対象範囲), `attendance_day:read`(対象範囲) |
| `attendance.correction.request_for_others` | `correction_request:create`(対象範囲), `punch:read`, `attendance_day:read` |
| `attendance.correction.approve` | `correction_request:approve`, `correction_request:read`, `attendance_day:read`, `punch:read` |
| `attendance.correction.view_all` | `correction_request:read` |
| `attendance.record.view` | `attendance_day:read`, `punch:read` |
| `shift.manage` | `shift_plan:create/update/publish`(対象範囲), `attendance_day:read` |
| `leave.request.approve` | `leave_request:approve`, `leave_request:read`, `attendance_day:read` |
| `leave.request.view_all` | `leave_request:read` |
| `leave.grant.manage` | `leave_grant:create`, `leave_grant:update`, `leave_grant:read` |
| `leave.balance.view` | `leave_grant:read` |
| `leave.mandatory_five_days.view` | `leave_grant:read`, `leave_request:read` |
| `closing.execute` | `closing:execute`, `closing:read`, `attendance_day:read` |
| `closing.unlock` | `closing:unlock`, `closing:read`, `audit_log:read`(締め関連エントリ) |
| `closing.view` | `closing:read` |
| `export.attendance.run` | `export:execute`, `attendance_day:read` |
| `alert.labor_limit.view` | `alert_config:read`, `attendance_day:read` |
| `alert.labor_limit.configure` | `alert_config:update`, `alert_config:read` |
| `member.invite` | `member:create`, `member:read` |
| `member.profile.edit` | `member:update`, `member:read` |
| `member.deactivate` | `member:delete`, `member:read` |
| `member.view` | `member:read` |
| `department.manage` | `department:create`, `department:update`, `department:delete`, `department:read` |
| `tenant_settings.calendar.manage` | `tenant_settings:update`(target=calendar), `tenant_settings:read` |
| `tenant_settings.flex.manage` | `tenant_settings:update`(target=flex), `tenant_settings:read` |
| `tenant_settings.gps.manage` | `tenant_settings:update`(target=gps), `tenant_settings:read` |
| `tenant_settings.auto_deduction.manage` | `tenant_settings:update`(target=auto_deduction), `tenant_settings:read` |
| `notification.settings.manage` | `tenant_settings:update`(target=notification), `tenant_settings:read` |
| `permission.preset.manage` | `permission_preset:create`, `permission_preset:update`, `permission_preset:read` |
| `permission.assignment.manage` | `permission_preset:assign`, `permission_preset:read`, `member:read` |
| `audit_log.view` | `audit_log:read` |
| `api_key.manage` | `api_key:create`, `api_key:revoke`, `api_key:read` |

## 4. 標準プリセット3種の権限割当表(v0.1同梱)

凡例: セルの値は付与スコープ。「―」は未付与。「※」は上位権限のON操作に伴い自動的に有効になる(閲覧の含意)ため、プリセット上は明示的な追加ON不要であることを示す。

| 業務タスク権限 | 管理者 | マネージャー | メンバー |
|---|---|---|---|
| `attendance.punch.proxy` | テナント全体 | ― | ― |
| `attendance.correction.request_for_others` | テナント全体 | ― | ― |
| `attendance.correction.approve` | テナント全体 | 自部署+配下部署 | ― |
| `attendance.correction.view_all` | テナント全体※ | 自部署+配下部署※ | ― |
| `attendance.record.view` | テナント全体 | 自部署+配下部署 | ― |
| `leave.request.approve` | テナント全体 | 自部署+配下部署 | ― |
| `leave.request.view_all` | テナント全体※ | 自部署+配下部署※ | ― |
| `leave.grant.manage` | テナント全体 | ― | ― |
| `leave.balance.view` | テナント全体※ | 自部署+配下部署 | ― |
| `leave.mandatory_five_days.view` | テナント全体 | 自部署+配下部署 | ― |
| `closing.execute` | テナント全体 | ― | ― |
| `closing.unlock` | テナント全体 | ― | ― |
| `closing.view` | テナント全体※ | 自部署+配下部署 | ― |
| `export.attendance.run` | テナント全体 | 自部署+配下部署 | ― |
| `alert.labor_limit.view` | テナント全体※ | 自部署+配下部署 | ― |
| `alert.labor_limit.configure` | テナント全体 | ― | ― |
| `member.invite` | テナント全体 | ― | ― |
| `member.profile.edit` | テナント全体 | 自部署+配下部署 | ― |
| `member.deactivate` | テナント全体 | ― | ― |
| `member.view` | テナント全体※ | 自部署+配下部署 | ― |
| `department.manage` | テナント全体 | ― | ― |
| `tenant_settings.calendar.manage` | テナント全体 | ― | ― |
| `tenant_settings.flex.manage` | テナント全体 | ― | ― |
| `tenant_settings.gps.manage` | テナント全体 | ― | ― |
| `tenant_settings.auto_deduction.manage` | テナント全体 | ― | ― |
| `notification.settings.manage` | テナント全体 | ― | ― |
| `permission.preset.manage` | テナント全体 | ― | ― |
| `permission.assignment.manage` | テナント全体 | ― | ― |
| `audit_log.view` | テナント全体 | ― | ― |
| `api_key.manage` | テナント全体 | ― | ― |

**メンバー**プリセットはカタログ上の権限を一切持たない。全メンバー共通の自分打刻・自分の申請起票・自分の記録閲覧は、プリセットに依らない固定のセルフサービス権限として別途常時付与される(本カタログの対象外)。

## レビュー論点の精査(2026-08-22)

v0.2 のスコープ実判定・カスタムプリセット編集UIの実装により、当初の論点の多くが解消した。

### 対応した

- **`department.manage` を危険フラグに格上げ**。スコープの実判定(`apps/api/src/lib/scope.ts`)が
  入り、部署の移動が「誰が誰を閲覧・承認できるか」を変えるようになったため、実質的に権限変更に
  あたる。機械可読な正は `packages/authz/src/catalog.ts`

### 実装により解消した

- **マネージャープリセットのスコープ粒度**(課長=自部署 / 部長=配下含む): カスタムプリセット
  編集UIが v0.2 で実装され、各社が役職に応じたプリセットを作れるようになった。同梱プリセットは
  あくまで出発点
- **`permission.preset.manage` / `permission.assignment.manage` の意味**: 編集UIが実装され、
  同梱3プリセットの枠を超えて機能するようになった
- **危険フラグと §10 コンテキストヘルプの切り分け**: 別軸として実装で確定した。
  §10 は `HelpTip`(全画面の説明)、危険フラグはプリセット編集画面での重点表示。
  承認系は前者の対象だが後者ではない、という当初の切り分けで問題ない

### 設計として受け入れる(変更しない)

- **`leave.grant.manage` の危険フラグは維持**。付与日数を誤ると年5日義務などの法定要件を
  満たせなくなり、かつ遡及して影響するため、締め解除・権限管理と同列でよい
- **`tenant_settings` は単一リソース + `target` 属性**。「日界だけ設定できるが GPS は触れない」
  のような細粒度が必要になった時点でリソース分割を検討する。カタログ側は業務タスク単位で
  既に分かれているため実害はない
- **`alert_config` は設定と状況閲覧を同一リソース**。別ロールに分けたいニーズが出たら分離する
- **`notification.settings.manage` は `tenant_settings` の一部**として展開。同上

### 継続検討(実運用の様子を見る)

- **代理打刻 `attendance.punch.proxy` / 代理申請の解放範囲**: 同梱プリセットでは管理者専用の
  まま。代理打刻は「客観的な記録」という前提を崩しうるため慎重でよい。`punch_events` は
  `actor_id` を持つので誰が代理したかは追跡できる。マネージャーへ解放したい会社は
  カスタムプリセットで対応できる
- **エクスポートの追加ガード**: 誰がどの月を出力したかは監査ログに記録済み。承認必須化や
  ダウンロード履歴の強調表示は、実際に運用してから必要性を判断する
