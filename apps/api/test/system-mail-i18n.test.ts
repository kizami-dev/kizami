/**
 * システムメールの文面カタログ(lib/system-mail-i18n.ts)と、各ルートのビルダー(locale 付き)のテスト。
 */
import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES, type Locale } from "../src/lib/locale.js";
import { formatJstDateTimeForLocale } from "../src/lib/system-mail-i18n.js";
import { buildWithdrawalCompletedMail, buildWithdrawalReminderMail, buildWithdrawalRequestedMail } from "../src/lib/tenant-withdrawal.js";
import { buildSelfServiceResetMail } from "../src/routes/password-resets.js";
import { buildSignupVerificationMail } from "../src/routes/signup.js";

const VERIFY_URL = "https://app.example.com/signup/verify/tok-1";
const RESET_URL_1 = "https://app.example.com/reset/tok-a";
const RESET_URL_2 = "https://app.example.com/reset/tok-b";
const APP = "https://app.example.com";
/** 2026-10-07 12:34 JST = 03:34 UTC */
const PURGE_AT = Date.UTC(2026, 9, 7, 3, 34) / 60_000;

describe("日本語版は従来の文面から変わらない", () => {
  it("サインアップの確認", () => {
    expect(buildSignupVerificationMail({ to: "a@example.com", verifyUrl: VERIFY_URL, locale: "ja" })).toEqual({
      to: "a@example.com",
      subject: "【KIZAMI】メールアドレスの確認",
      text: [
        "KIZAMI への新規登録を受け付けました。",
        "",
        "次のリンクを開いて、メールアドレスの確認と登録の完了をしてください(24時間有効)。",
        "確認画面で登録内容を確認し、パスワードを設定すると、組織(テナント)が作成されます。",
        "",
        VERIFY_URL,
        "",
        "このメールに心当たりがない場合は、何もせずに破棄してください。リンクを開かない限り、何も作成されません。",
      ].join("\n"),
    });
  });

  it("パスワード再設定(1件・複数件)", () => {
    expect(buildSelfServiceResetMail({ to: "a@example.com", resetUrls: [RESET_URL_1], locale: "ja" })).toEqual({
      to: "a@example.com",
      subject: "【KIZAMI】パスワード再設定のご案内",
      text: [
        "KIZAMI のパスワード再設定のご依頼を受け付けました。",
        "",
        "次のリンクを開いて、新しいパスワードを設定してください(1時間有効)。",
        "",
        RESET_URL_1,
        "",
        "このメールに心当たりがない場合は、何もせずに破棄してください。リンクを開かない限り、パスワードは変わりません。",
      ].join("\n"),
    });
    expect(buildSelfServiceResetMail({ to: "a@example.com", resetUrls: [RESET_URL_1, RESET_URL_2], locale: "ja" }).text).toBe(
      [
        "KIZAMI のパスワード再設定のご依頼を受け付けました。",
        "",
        "このメールアドレスで登録されているアカウントが複数あります。再設定したいアカウントのリンクを開いて、",
        "新しいパスワードを設定してください(いずれも1時間有効)。どの組織のアカウントかはリンク先の画面に表示されます。",
        "",
        "アカウント1",
        RESET_URL_1,
        "",
        "アカウント2",
        RESET_URL_2,
        "",
        "このメールに心当たりがない場合は、何もせずに破棄してください。リンクを開かない限り、パスワードは変わりません。",
      ].join("\n"),
    );
  });

  const retention = [
    "■ 削除の前に、必ず全データをエクスポートして保存してください",
    "労働基準法109条により、出勤簿などの労働関係に関する重要な書類は、事業主が5年間(令和2年改正法の附則による経過措置により、当分の間は3年間)保存しなければなりません。",
    "この保存義務は事業主(貴社)の義務であり、KIZAMI からデータが削除されてもなくなりません。",
  ];

  it("退会の申請", () => {
    expect(buildWithdrawalRequestedMail({ appBaseUrl: APP, scheduledPurgeAt: PURGE_AT, locale: "ja" })).toEqual({
      subject: "【KIZAMI】テナントの退会のお申し込みを受け付けました",
      text: [
        "KIZAMI をご利用いただいているテナント(会社)について、退会のお申し込みを受け付けました。",
        "",
        "削除予定日時: 2026-10-07 12:34(日本時間)以降",
        "この日時を過ぎると、テナントのすべてのデータ(勤怠記録・メンバー・設定・監査ログ)を物理削除します。削除したデータは元に戻せません。",
        "それまでの間、管理者以外の方はログインできず、打刻と通知も止まります。",
        "",
        ...retention,
        "全データのエクスポートと退会の取り消しは、次の画面から行えます。",
        `${APP}/settings/withdrawal`,
        "",
        "このお申し込みに心当たりがない場合は、すぐに上の画面から退会を取り消してください。",
        "このメールは、退会を申請・取り消しできる権限を持つ方全員にお送りしています。",
      ].join("\n"),
    });
  });

  it("削除の7日前", () => {
    expect(buildWithdrawalReminderMail({ appBaseUrl: APP, scheduledPurgeAt: PURGE_AT, locale: "ja" })).toEqual({
      subject: "【KIZAMI】テナントのデータの削除が近づいています",
      text: [
        "退会のお申し込みをいただいているテナント(会社)のデータの削除が近づいています。",
        "",
        "削除予定日時: 2026-10-07 12:34(日本時間)以降",
        "この日時を過ぎると、すべてのデータを物理削除します。削除したデータは元に戻せません。",
        "",
        ...retention,
        "全データのエクスポートと退会の取り消しは、次の画面から行えます。",
        `${APP}/settings/withdrawal`,
      ].join("\n"),
    });
  });

  it("削除の完了", () => {
    expect(buildWithdrawalCompletedMail({ locale: "ja" })).toEqual({
      subject: "【KIZAMI】テナントのデータの削除が完了しました",
      text: [
        "退会のお申し込みをいただいていたテナント(会社)のデータの削除が完了しました。",
        "勤怠記録・メンバー・設定・監査ログを含むすべてのデータを削除しました。",
        "",
        "なお、障害に備えたバックアップには、削除したデータが保存期間(最長で約13か月)の間残ります。バックアップは障害からの復旧にだけ使い、復旧したときは削除済みのテナントをあらためて削除します。",
        "",
        "これまで KIZAMI をご利用いただき、ありがとうございました。",
      ].join("\n"),
    });
  });
});

const JST_LABEL: Record<Locale, string> = { ja: "(日本時間)", en: "(JST)", ko: "(일본 시간)", zh: "(日本时间)", "zh-Hant": "(日本時間)" };

describe.each(SUPPORTED_LOCALES)("全ロケール: %s", (locale: Locale) => {
  const mails = () => [
    { name: "signup", mail: buildSignupVerificationMail({ to: "a@example.com", verifyUrl: VERIFY_URL, locale }), urls: [VERIFY_URL] },
    { name: "reset-1", mail: buildSelfServiceResetMail({ to: "a@example.com", resetUrls: [RESET_URL_1], locale }), urls: [RESET_URL_1] },
    { name: "reset-2", mail: buildSelfServiceResetMail({ to: "a@example.com", resetUrls: [RESET_URL_1, RESET_URL_2], locale }), urls: [RESET_URL_1, RESET_URL_2] },
    { name: "requested", mail: buildWithdrawalRequestedMail({ appBaseUrl: APP, scheduledPurgeAt: PURGE_AT, locale }), urls: [`${APP}/settings/withdrawal`] },
    { name: "reminder", mail: buildWithdrawalReminderMail({ appBaseUrl: APP, scheduledPurgeAt: PURGE_AT, locale }), urls: [`${APP}/settings/withdrawal`] },
    { name: "completed", mail: buildWithdrawalCompletedMail({ locale }), urls: [] },
  ];

  it("件名・本文が空でなく、URL を含み、undefined / 未置換の断片を含まない", () => {
    for (const { name, mail, urls } of mails()) {
      expect(mail.subject.length, name).toBeGreaterThan(0);
      expect(mail.text.length, name).toBeGreaterThan(0);
      for (const url of urls) expect(mail.text, name).toContain(url);
      for (const part of [mail.subject, mail.text]) {
        expect(part, name).not.toMatch(/undefined|NaN|\[object|\$\{/);
      }
    }
  });

  it("件名の接頭辞は ja が「【KIZAMI】」、他は「[KIZAMI] 」", () => {
    for (const { name, mail } of mails()) {
      expect(mail.subject.startsWith(locale === "ja" ? "【KIZAMI】" : "[KIZAMI] "), name).toBe(true);
    }
  });

  it("退会の申請・再通知は、日本時間の日時(と日本時間の明記)・労基法109条・5年・3年を含む", () => {
    for (const mail of [
      buildWithdrawalRequestedMail({ appBaseUrl: APP, scheduledPurgeAt: PURGE_AT, locale }),
      buildWithdrawalReminderMail({ appBaseUrl: APP, scheduledPurgeAt: PURGE_AT, locale }),
    ]) {
      expect(mail.text).toContain(formatJstDateTimeForLocale(PURGE_AT, locale));
      expect(mail.text).toContain(JST_LABEL[locale]);
      expect(mail.text).toContain("109");
      expect(mail.text).toMatch(locale === "en" ? /five years.*three years/s : /5.*3/s);
    }
  });

  it("複数アカウントのリンクは順に並び、全リンクが入る", () => {
    const text = buildSelfServiceResetMail({ to: "a@example.com", resetUrls: [RESET_URL_1, RESET_URL_2], locale }).text;
    expect(text.indexOf(RESET_URL_1)).toBeGreaterThan(0);
    expect(text.indexOf(RESET_URL_1)).toBeLessThan(text.indexOf(RESET_URL_2));
  });
});

describe("日時の書式(日本時間のまま、言語ごとに自然な形)", () => {
  it.each([
    ["ja", "2026-10-07 12:34"],
    ["en", "Oct 7, 2026, 12:34"],
    ["ko", "2026년 10월 7일 12:34"],
    ["zh", "2026年10月7日 12:34"],
    ["zh-Hant", "2026年10月7日 12:34"],
  ] as const)("%s", (locale, expected) => {
    expect(formatJstDateTimeForLocale(PURGE_AT, locale)).toBe(expected);
  });

  it("UTC では日付が変わる時刻(15:00 UTC = 翌 00:00 JST)も日本時間で出す", () => {
    expect(formatJstDateTimeForLocale(Date.UTC(2026, 11, 31, 15, 0) / 60_000, "en")).toBe("Jan 1, 2027, 00:00");
  });
});

describe("英語の件名(5通)", () => {
  it("一覧", () => {
    expect(buildSignupVerificationMail({ to: "a@b.c", verifyUrl: VERIFY_URL, locale: "en" }).subject).toBe("[KIZAMI] Confirm your email address");
    expect(buildSelfServiceResetMail({ to: "a@b.c", resetUrls: [RESET_URL_1], locale: "en" }).subject).toBe("[KIZAMI] Reset your password");
    expect(buildWithdrawalRequestedMail({ appBaseUrl: APP, scheduledPurgeAt: PURGE_AT, locale: "en" }).subject).toBe("[KIZAMI] We received your tenant withdrawal request");
    expect(buildWithdrawalReminderMail({ appBaseUrl: APP, scheduledPurgeAt: PURGE_AT, locale: "en" }).subject).toBe("[KIZAMI] Your tenant's data is about to be deleted");
    expect(buildWithdrawalCompletedMail({ locale: "en" }).subject).toBe("[KIZAMI] Your tenant's data has been deleted");
  });
});
