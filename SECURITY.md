# Security Policy

## 脆弱性の報告 / Reporting a Vulnerability

脆弱性を発見した場合は、公開 Issue ではなく GitHub の
[Private vulnerability reporting](https://github.com/kizami-dev/kizami/security/advisories/new)
から報告してください。
Please report vulnerabilities via GitHub's private vulnerability reporting,
not public issues.

- 初回応答の目安: 7日以内 / Initial response: within 7 days
- 修正がリリースされるまで詳細の公開はお控えください / Please allow us to ship a fix before public disclosure

## サポート対象 / Supported Versions

最新のリリース(main ブランチ)のみが対象です。
Only the latest release (main branch) receives security fixes.

## 設計上の注意 / Notes for self-hosters

- `KIZAMI_ENCRYPTION_KEY` は保存時暗号化(Webhook URL・SSO の client secret・二要素認証の共有鍵)の鍵です。漏えい時はローテーションし、保存済みの秘密を再登録してください。**鍵を失うと二要素認証を有効にしている利用者はログインできなくなります**(管理者による 2FA リセットで復旧します)
- 二要素認証(TOTP)は利用者が個人で有効化できます。人事データを扱う性質上、少なくとも権限の強いアカウントでの利用を推奨します
- 勤怠データには個人情報が含まれます。公開インスタンスにする場合はリバースプロキシでの TLS 終端と、ログイン試行の制限(fail2ban 等)を推奨します
