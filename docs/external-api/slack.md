# Slack コマンド打刻(準備中)

Slack のスラッシュコマンドから打刻できるようにする機能です。**実装はまだ入っていません**が、
導入に必要な準備と設計方針をここに記します。

## Slack 側の準備(導入する会社が行う)

Slack の**無料プランでも利用できます**。ただし無料プランはワークスペース全体で
**アプリ数の上限が10個**なので、既存のアプリ数に余裕があるか確認してください
(スラッシュコマンドの実行回数に制限はありません)。

1. <https://api.slack.com/apps> で **Create New App**(From scratch)
2. **Slash Commands** → **Create New Command**
   - Command: `/punch`
   - Request URL: `https://<KIZAMIのURL>/api/slack/commands`
   - Short Description: 出退勤を打刻する
   - Usage Hint: `in | out | break | back | status`
3. **Basic Information** の **Signing Secret** を控える
   (KIZAMI 側の設定画面に登録し、リクエストが本当に Slack から来たかを検証します)
4. ワークスペースにインストール

## 設計方針

### リクエストの検証

Slack からのリクエストは **Signing Secret による署名検証**を必ず行います
(`X-Slack-Signature` と `X-Slack-Request-Timestamp`)。5分より古いリクエストは
リプレイ攻撃とみなして拒否します。Signing Secret は他の秘密情報と同様に暗号化して保存します。

### ユーザーの紐付け

**メールアドレスでの自動照合を既定**とします。Slack の `user_id` から取得したメールアドレスと
KIZAMI のアカウントを突き合わせ、一致すればそのユーザーとして打刻します。
一致しない場合のみ、明示的な連携手順(ワンタイムトークンによる紐付け)に誘導します。

ほとんどの場合は設定なしで使い始められ、例外だけ手当てできる形です。

### コマンド

| コマンド | 動作 |
| --- | --- |
| `/punch in` | 出勤 |
| `/punch out` | 退勤 |
| `/punch break` | 休憩に入る |
| `/punch back` | 休憩から戻る |
| `/punch status` | 現在の状態と今日の打刻 |

- 応答は **ephemeral**(本人にだけ見える)にします。打刻の事実が他のメンバーに流れないようにするためです
- 無効な遷移(勤務外の退勤など)は、実行前に理由を添えて断ります
- 打刻の `source` は `slack` として記録します

### 打刻の証跡

Slack 経由の打刻には位置情報が付きません。IP や UA も Slack のサーバーのものになるため、
**「誰が」の裏付けは Slack の署名検証とアカウント紐付けに依存**します。
この特性を踏まえ、GPS が必要な運用では Web/PWA からの打刻を案内してください。
