# Security Policy

## 脆弱性の報告 / Reporting a Vulnerability

脆弱性を発見した場合は、公開 Issue ではなく GitHub の
[Private vulnerability reporting](https://github.com/sasagar/kizami/security/advisories/new)
から報告してください。
Please report vulnerabilities via GitHub's private vulnerability reporting,
not public issues.

- 初回応答の目安: 7日以内 / Initial response: within 7 days
- 修正がリリースされるまで詳細の公開はお控えください / Please allow us to ship a fix before public disclosure

## サポート対象 / Supported Versions

最新のリリース(main ブランチ)のみが対象です。
Only the latest release (main branch) receives security fixes.

## 設計上の注意 / Notes for self-hosters

- `KIZAMI_ENCRYPTION_KEY` は保存時暗号化(Webhook URL 等)の鍵です。漏えい時はローテーションし、保存済みの秘密を再登録してください
- 勤怠データには個人情報が含まれます。公開インスタンスにする場合はリバースプロキシでの TLS 終端と、ログイン試行の制限(fail2ban 等)を推奨します
