/**
 * システムメール(運用者名義のメール)の文面カタログ(2026-10-07、多言語化)。
 *
 * 対象は5通: サインアップの確認(routes/signup.ts)、本人用のパスワード再設定(routes/password-resets.ts)、
 * 退会の申請・削除の7日前・削除の完了(lib/tenant-withdrawal.ts)。各ビルダーは従来の引数に `locale` を
 * 足しただけで、文面の中身はここに集めた(5言語 x 5通を各ファイルに散らすと、翻訳の見直しと
 * 「全ロケールで URL が入っているか」の検証が散らばる)。
 *
 * ## 守る性質(従来の日本語版と同じ。全ロケールで保つ)
 *
 * - **ユーザー入力もテナント名も本文に入れない**。文面は固定で、入るのは URL・日時・番号だけ。未認証で
 *   誰でも任意の宛先に出させられるメールに自由入力を入れると、運用者名義のフィッシングの踏み台になる
 *   (各ルートの冒頭コメントの判断点)。ロケールも**自由入力ではなく許可リスト(lib/locale.ts)の値**なので、
 *   この性質は壊さない
 * - 日本語版は従来の文字列と**一字一句同じ**(test/system-mail-i18n.test.ts が固定の文字列と比較する)
 *
 * ## 表記の判断点
 *
 * - 件名の接頭辞: ja は「【KIZAMI】」、他は「[KIZAMI] 」(全角の隅付き括弧は日本語の文脈の約物で、
 *   他言語の件名だと文字化けのように見えるメーラーがあるため)
 * - 日時は**日本時間のまま**(削除予定の時刻はサーバーの運用上の基準で、受信者の所在地に変換すると
 *   画面・API・CLI の表示とずれる)。ja は「(日本時間)」、他は「(JST)」と明記し、書式は言語ごとに自然な形にする。
 *   時刻は 24 時間表記で AM/PM の取り違えを避ける
 * - 用語は Web の辞書(apps/web/src/lib/i18n/*.ts)に揃えた: 退会 = en "withdrawal" / ko "탈퇴" /
 *   zh(简体)"注销" / zh-Hant "終止服務"。テナント = en "tenant (company)" / ko "테넌트(회사)" /
 *   zh "租户(公司)" / zh-Hant は辞書が「公司」だけを使うので「公司」
 * - 労基法109条の案内は日本語版の内容(5年、令和2年改正法の附則による経過措置で当分の間3年)をそのまま訳し、
 *   法令名は「Labor Standards Act of Japan, Article 109」のように日本の法律だと分かる形にする
 */

import type { Locale } from "./locale.js";

export interface SystemMailContent {
  subject: string;
  text: string;
}

const MINUTE_MS = 60_000;
/** 日本時間(UTC+9)。lib/settings.ts の TZ_OFFSET_MINUTES_JST と同じ値(ここは循環を避けて持つ)。 */
const JST_OFFSET_MINUTES = 9 * 60;

const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** UTC エポック分 → 日本時間の日時を、ロケールごとに自然な書式にしたもの(日本時間の注記は付けない)。 */
export function formatJstDateTimeForLocale(minutes: number, locale: Locale): string {
  const iso = new Date((minutes + JST_OFFSET_MINUTES) * MINUTE_MS).toISOString();
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  const time = iso.slice(11, 16);
  switch (locale) {
    case "ja":
      return iso.slice(0, 16).replace("T", " ");
    case "en":
      return `${EN_MONTHS[month - 1]} ${day}, ${year}, ${time}`;
    case "ko":
      return `${year}년 ${month}월 ${day}일 ${time}`;
    case "zh":
    case "zh-Hant":
      return `${year}年${month}月${day}日 ${time}`;
  }
}

interface MailCatalog {
  /** 件名の接頭辞 */
  prefix: string;
  signup: { subject: string; body: (verifyUrl: string) => string[] };
  reset: {
    subject: string;
    /** リンクが1つのとき */
    single: (url: string) => string[];
    /** リンクが複数のとき(アカウントごとに番号を付けて並べる) */
    multiIntro: string[];
    accountLabel: (n: number) => string;
    outro: string;
  };
  withdrawal: {
    requested: { subject: string; intro: string; afterPurge: string[]; closing: string[] };
    reminder: { subject: string; intro: string; afterPurge: string[] };
    completed: { subject: string; body: string[] };
    /** 「削除予定日時: <日時>(日本時間)以降」の行(日時は formatJstDateTimeForLocale の結果) */
    purgeAtLine: (dateTime: string) => string;
    /** 労基法109条の保存義務の案内(申請・再通知に共通) */
    retention: string[];
    /** エクスポートと取り消しの画面への案内(この次の行に URL を置く) */
    settingsLead: string;
  };
}

const ja: MailCatalog = {
  prefix: "【KIZAMI】",
  signup: {
    subject: "メールアドレスの確認",
    body: (verifyUrl) => [
      "KIZAMI への新規登録を受け付けました。",
      "",
      "次のリンクを開いて、メールアドレスの確認と登録の完了をしてください(24時間有効)。",
      "確認画面で登録内容を確認し、パスワードを設定すると、組織(テナント)が作成されます。",
      "",
      verifyUrl,
      "",
      "このメールに心当たりがない場合は、何もせずに破棄してください。リンクを開かない限り、何も作成されません。",
    ],
  },
  reset: {
    subject: "パスワード再設定のご案内",
    single: (url) => ["KIZAMI のパスワード再設定のご依頼を受け付けました。", "", "次のリンクを開いて、新しいパスワードを設定してください(1時間有効)。", "", url],
    multiIntro: [
      "KIZAMI のパスワード再設定のご依頼を受け付けました。",
      "",
      "このメールアドレスで登録されているアカウントが複数あります。再設定したいアカウントのリンクを開いて、",
      "新しいパスワードを設定してください(いずれも1時間有効)。どの組織のアカウントかはリンク先の画面に表示されます。",
    ],
    accountLabel: (n) => `アカウント${n}`,
    outro: "このメールに心当たりがない場合は、何もせずに破棄してください。リンクを開かない限り、パスワードは変わりません。",
  },
  withdrawal: {
    requested: {
      subject: "テナントの退会のお申し込みを受け付けました",
      intro: "KIZAMI をご利用いただいているテナント(会社)について、退会のお申し込みを受け付けました。",
      afterPurge: [
        "この日時を過ぎると、テナントのすべてのデータ(勤怠記録・メンバー・設定・監査ログ)を物理削除します。削除したデータは元に戻せません。",
        "それまでの間、管理者以外の方はログインできず、打刻と通知も止まります。",
      ],
      closing: [
        "このお申し込みに心当たりがない場合は、すぐに上の画面から退会を取り消してください。",
        "このメールは、退会を申請・取り消しできる権限を持つ方全員にお送りしています。",
      ],
    },
    reminder: {
      subject: "テナントのデータの削除が近づいています",
      intro: "退会のお申し込みをいただいているテナント(会社)のデータの削除が近づいています。",
      afterPurge: ["この日時を過ぎると、すべてのデータを物理削除します。削除したデータは元に戻せません。"],
    },
    completed: {
      subject: "テナントのデータの削除が完了しました",
      body: [
        "退会のお申し込みをいただいていたテナント(会社)のデータの削除が完了しました。",
        "勤怠記録・メンバー・設定・監査ログを含むすべてのデータを削除しました。",
        "",
        "なお、障害に備えたバックアップには、削除したデータが保存期間(最長で約13か月)の間残ります。バックアップは障害からの復旧にだけ使い、復旧したときは削除済みのテナントをあらためて削除します。",
        "",
        "これまで KIZAMI をご利用いただき、ありがとうございました。",
      ],
    },
    purgeAtLine: (dt) => `削除予定日時: ${dt}(日本時間)以降`,
    retention: [
      "■ 削除の前に、必ず全データをエクスポートして保存してください",
      "労働基準法109条により、出勤簿などの労働関係に関する重要な書類は、事業主が5年間(令和2年改正法の附則による経過措置により、当分の間は3年間)保存しなければなりません。",
      "この保存義務は事業主(貴社)の義務であり、KIZAMI からデータが削除されてもなくなりません。",
    ],
    settingsLead: "全データのエクスポートと退会の取り消しは、次の画面から行えます。",
  },
};

const en: MailCatalog = {
  prefix: "[KIZAMI] ",
  signup: {
    subject: "Confirm your email address",
    body: (verifyUrl) => [
      "We received your sign-up request for KIZAMI.",
      "",
      "Open the link below to confirm your email address and complete your sign-up (valid for 24 hours).",
      "On the confirmation page, review your details and set a password; your organization (tenant) will then be created.",
      "",
      verifyUrl,
      "",
      "If you do not recognize this email, simply discard it. Nothing is created unless you open the link.",
    ],
  },
  reset: {
    subject: "Reset your password",
    single: (url) => ["We received a request to reset your KIZAMI password.", "", "Open the link below to set a new password (valid for 1 hour).", "", url],
    multiIntro: [
      "We received a request to reset your KIZAMI password.",
      "",
      "More than one account is registered with this email address. Open the link for the account you want to reset",
      "and set a new password (each link is valid for 1 hour). The organization of each account is shown on the page the link opens.",
    ],
    accountLabel: (n) => `Account ${n}`,
    outro: "If you do not recognize this email, simply discard it. Your password will not change unless you open a link.",
  },
  withdrawal: {
    requested: {
      subject: "We received your tenant withdrawal request",
      intro: "We received a request to withdraw a tenant (company) that uses KIZAMI.",
      afterPurge: [
        "After this time, all data of the tenant (attendance records, members, settings and audit logs) will be permanently deleted. Deleted data cannot be restored.",
        "Until then, only administrators can sign in, and punching and notifications are stopped.",
      ],
      closing: [
        "If you do not recognize this request, cancel the withdrawal right away from the page above.",
        "This email is sent to everyone who has the permission to request or cancel a withdrawal.",
      ],
    },
    reminder: {
      subject: "Your tenant's data is about to be deleted",
      intro: "The data of a tenant (company) that has requested withdrawal is about to be deleted.",
      afterPurge: ["After this time, all data will be permanently deleted. Deleted data cannot be restored."],
    },
    completed: {
      subject: "Your tenant's data has been deleted",
      body: [
        "The data of the tenant (company) that requested withdrawal has been deleted.",
        "All data, including attendance records, members, settings and audit logs, has been deleted.",
        "",
        "Note that backups kept for disaster recovery retain the deleted data for the retention period (up to about 13 months). Backups are used only to recover from failures, and when one is restored, the deleted tenant is deleted again.",
        "",
        "Thank you for using KIZAMI.",
      ],
    },
    purgeAtLine: (dt) => `Scheduled deletion: on or after ${dt} (JST)`,
    retention: [
      "■ Before the deletion, be sure to export and keep all of your data",
      "Under the Labor Standards Act of Japan, Article 109, the employer must keep important records on labor relations, such as attendance records, for five years (three years for the time being under the transitional measure in the supplementary provisions of the 2020 (Reiwa 2) amendment).",
      "This is the employer's (your company's) obligation, and it does not end when the data is deleted from KIZAMI.",
    ],
    settingsLead: "You can export all data and cancel the withdrawal from the page below.",
  },
};

const ko: MailCatalog = {
  prefix: "[KIZAMI] ",
  signup: {
    subject: "이메일 주소 확인",
    body: (verifyUrl) => [
      "KIZAMI 신규 가입 신청을 접수했습니다.",
      "",
      "아래 링크를 열어 이메일 주소를 확인하고 가입을 완료해 주세요(24시간 유효).",
      "확인 화면에서 가입 내용을 확인하고 비밀번호를 설정하면 조직(테넌트)이 만들어집니다.",
      "",
      verifyUrl,
      "",
      "이 메일에 짚이는 데가 없다면 아무것도 하지 말고 폐기해 주세요. 링크를 열지 않는 한 아무것도 만들어지지 않습니다.",
    ],
  },
  reset: {
    subject: "비밀번호 재설정 안내",
    single: (url) => ["KIZAMI 비밀번호 재설정 요청을 접수했습니다.", "", "아래 링크를 열어 새 비밀번호를 설정해 주세요(1시간 유효).", "", url],
    multiIntro: [
      "KIZAMI 비밀번호 재설정 요청을 접수했습니다.",
      "",
      "이 이메일 주소로 등록된 계정이 여러 개 있습니다. 재설정하려는 계정의 링크를 열어",
      "새 비밀번호를 설정해 주세요(모두 1시간 유효). 어느 조직의 계정인지는 링크를 열면 나오는 화면에 표시됩니다.",
    ],
    accountLabel: (n) => `계정 ${n}`,
    outro: "이 메일에 짚이는 데가 없다면 아무것도 하지 말고 폐기해 주세요. 링크를 열지 않는 한 비밀번호는 바뀌지 않습니다.",
  },
  withdrawal: {
    requested: {
      subject: "테넌트 탈퇴 신청을 접수했습니다",
      intro: "KIZAMI를 이용 중인 테넌트(회사)의 탈퇴 신청을 접수했습니다.",
      afterPurge: [
        "이 일시가 지나면 테넌트의 모든 데이터(근태 기록·멤버·설정·감사 로그)를 영구 삭제합니다. 삭제한 데이터는 되돌릴 수 없습니다.",
        "그때까지 관리자 외에는 로그인할 수 없고, 출퇴근 기록과 알림도 중지됩니다.",
      ],
      closing: [
        "이 신청에 짚이는 데가 없다면 즉시 위 화면에서 탈퇴를 취소해 주세요.",
        "이 메일은 탈퇴를 신청·취소할 수 있는 권한을 가진 모든 분께 보내고 있습니다.",
      ],
    },
    reminder: {
      subject: "테넌트 데이터 삭제가 다가오고 있습니다",
      intro: "탈퇴를 신청하신 테넌트(회사)의 데이터 삭제가 다가오고 있습니다.",
      afterPurge: ["이 일시가 지나면 모든 데이터를 영구 삭제합니다. 삭제한 데이터는 되돌릴 수 없습니다."],
    },
    completed: {
      subject: "테넌트 데이터 삭제가 완료되었습니다",
      body: [
        "탈퇴를 신청하신 테넌트(회사)의 데이터 삭제가 완료되었습니다.",
        "근태 기록·멤버·설정·감사 로그를 포함한 모든 데이터를 삭제했습니다.",
        "",
        "참고로 장애에 대비한 백업에는 삭제한 데이터가 보존 기간(최장 약 13개월) 동안 남아 있습니다. 백업은 장애 복구에만 사용하며, 복구했을 때는 삭제된 테넌트를 다시 삭제합니다.",
        "",
        "그동안 KIZAMI를 이용해 주셔서 감사합니다.",
      ],
    },
    purgeAtLine: (dt) => `삭제 예정 일시: ${dt}(일본 시간) 이후`,
    retention: [
      "■ 삭제하기 전에 반드시 전체 데이터를 내보내 보관해 주세요",
      "일본 노동기준법 제109조에 따라 출근부 등 노동 관계에 관한 중요한 서류는 사업주가 5년간(2020년(레이와 2년) 개정법 부칙의 경과 조치에 따라 당분간은 3년간) 보존해야 합니다.",
      "이 보존 의무는 사업주(귀사)의 의무이며, KIZAMI에서 데이터가 삭제되어도 없어지지 않습니다.",
    ],
    settingsLead: "전체 데이터 내보내기와 탈퇴 취소는 아래 화면에서 할 수 있습니다.",
  },
};

const zh: MailCatalog = {
  prefix: "[KIZAMI] ",
  signup: {
    subject: "邮箱地址确认",
    body: (verifyUrl) => [
      "我们已收到您在 KIZAMI 的新注册申请。",
      "",
      "请打开下方链接,确认邮箱地址并完成注册(24小时内有效)。",
      "在确认页面核对注册信息并设置密码后,将创建您的组织(租户)。",
      "",
      verifyUrl,
      "",
      "如果您对此邮件没有印象,请不要做任何操作,直接删除即可。只要不打开链接,就不会创建任何内容。",
    ],
  },
  reset: {
    subject: "密码重置指引",
    single: (url) => ["我们已收到您重置 KIZAMI 密码的请求。", "", "请打开下方链接,设置新密码(1小时内有效)。", "", url],
    multiIntro: [
      "我们已收到您重置 KIZAMI 密码的请求。",
      "",
      "此邮箱地址下注册了多个账号。请打开您要重置的账号对应的链接,",
      "设置新密码(均在1小时内有效)。该账号属于哪个组织,会显示在链接打开后的页面中。",
    ],
    accountLabel: (n) => `账号${n}`,
    outro: "如果您对此邮件没有印象,请不要做任何操作,直接删除即可。只要不打开链接,密码就不会改变。",
  },
  withdrawal: {
    requested: {
      subject: "已受理租户注销申请",
      intro: "我们已受理使用 KIZAMI 的租户(公司)的注销申请。",
      afterPurge: [
        "超过此时间后,将永久删除该租户的全部数据(考勤记录、成员、设置、审计日志)。删除后的数据无法恢复。",
        "在此之前,除管理员外的其他人将无法登录,打卡和通知也将停止。",
      ],
      closing: [
        "如果您对此申请没有印象,请立即从上方页面撤销注销。",
        "此邮件会发送给所有拥有申请或撤销注销权限的人员。",
      ],
    },
    reminder: {
      subject: "租户数据即将被删除",
      intro: "已申请注销的租户(公司)的数据即将被删除。",
      afterPurge: ["超过此时间后,将永久删除全部数据。删除后的数据无法恢复。"],
    },
    completed: {
      subject: "租户数据已删除完成",
      body: [
        "已申请注销的租户(公司)的数据已删除完成。",
        "包括考勤记录、成员、设置、审计日志在内的全部数据均已删除。",
        "",
        "另外,为应对故障而保留的备份中,已删除的数据会在保存期限(最长约13个月)内继续保留。备份仅用于故障恢复,恢复后会再次删除已被删除的租户。",
        "",
        "感谢您一直以来使用 KIZAMI。",
      ],
    },
    purgeAtLine: (dt) => `预定删除时间:${dt}(日本时间)之后`,
    retention: [
      "■ 删除之前,请务必导出并保存全部数据",
      "根据日本《劳动基准法》第109条,出勤簿等与劳动关系有关的重要文件,雇主必须保存5年(根据2020年(令和2年)修正法附则的过渡措施,目前为3年)。",
      "该义务是雇主(贵公司)的义务,即使从 KIZAMI 删除数据也不会消失。",
    ],
    settingsLead: "导出全部数据和撤销注销,可在下方页面进行。",
  },
};

const zhHant: MailCatalog = {
  prefix: "[KIZAMI] ",
  signup: {
    subject: "電子郵件地址確認",
    body: (verifyUrl) => [
      "我們已收到您在 KIZAMI 的新註冊申請。",
      "",
      "請開啟下方連結,確認電子郵件地址並完成註冊(24小時內有效)。",
      "在確認頁面核對註冊資訊並設定密碼後,將建立您的組織。",
      "",
      verifyUrl,
      "",
      "如果您對此郵件沒有印象,請不要進行任何操作,直接刪除即可。只要不開啟連結,就不會建立任何內容。",
    ],
  },
  reset: {
    subject: "密碼重設指引",
    single: (url) => ["我們已收到您重設 KIZAMI 密碼的請求。", "", "請開啟下方連結,設定新密碼(1小時內有效)。", "", url],
    multiIntro: [
      "我們已收到您重設 KIZAMI 密碼的請求。",
      "",
      "此電子郵件地址下註冊了多個帳號。請開啟您要重設的帳號對應的連結,",
      "設定新密碼(均在1小時內有效)。該帳號屬於哪個組織,會顯示在連結開啟後的頁面中。",
    ],
    accountLabel: (n) => `帳號${n}`,
    outro: "如果您對此郵件沒有印象,請不要進行任何操作,直接刪除即可。只要不開啟連結,密碼就不會改變。",
  },
  withdrawal: {
    requested: {
      subject: "已受理終止服務的申請",
      intro: "我們已受理使用 KIZAMI 的公司的終止服務申請。",
      afterPurge: [
        "超過此時間後,將永久刪除該公司的全部資料(出勤紀錄、成員、設定、稽核日誌)。刪除後的資料無法復原。",
        "在此之前,除了管理員之外,其他人將無法登入,打卡和通知也將停止。",
      ],
      closing: [
        "如果您對此申請沒有印象,請立即從上方頁面撤銷終止服務。",
        "此郵件會寄送給所有擁有申請或撤銷終止服務權限的人員。",
      ],
    },
    reminder: {
      subject: "公司的資料即將被刪除",
      intro: "已申請終止服務的公司的資料即將被刪除。",
      afterPurge: ["超過此時間後,將永久刪除全部資料。刪除後的資料無法復原。"],
    },
    completed: {
      subject: "公司的資料已刪除完成",
      body: [
        "已申請終止服務的公司的資料已刪除完成。",
        "包含出勤紀錄、成員、設定、稽核日誌在內的全部資料均已刪除。",
        "",
        "另外,為因應故障而保留的備份中,已刪除的資料會在保存期限(最長約13個月)內繼續保留。備份僅用於故障復原,復原後會再次刪除已被刪除的公司。",
        "",
        "感謝您一直以來使用 KIZAMI。",
      ],
    },
    purgeAtLine: (dt) => `預定刪除時間:${dt}(日本時間)之後`,
    retention: [
      "■ 刪除之前,請務必匯出並保存全部資料",
      "依據日本《勞動基準法》第109條,出勤簿等與勞動關係有關的重要文件,雇主必須保存5年(依據2020年(令和2年)修正法附則的過渡措施,目前為3年)。",
      "此義務是雇主(貴公司)的義務,即使從 KIZAMI 刪除資料也不會消失。",
    ],
    settingsLead: "匯出全部資料和撤銷終止服務,可在下方頁面進行。",
  },
};

const CATALOGS: Record<Locale, MailCatalog> = { ja, en, ko, zh, "zh-Hant": zhHant };

/** サインアップ確認メールの件名・本文。 */
export function signupVerificationContent(locale: Locale, params: { verifyUrl: string }): SystemMailContent {
  const c = CATALOGS[locale];
  return { subject: c.prefix + c.signup.subject, text: c.signup.body(params.verifyUrl).join("\n") };
}

/** 本人用パスワード再設定メールの件名・本文(リンクが複数なら番号付きで並べる)。 */
export function selfServiceResetContent(locale: Locale, params: { resetUrls: string[] }): SystemMailContent {
  const c = CATALOGS[locale].reset;
  const lines: string[] = [];
  if (params.resetUrls.length === 1) {
    lines.push(...c.single(params.resetUrls[0]!));
  } else {
    lines.push(...c.multiIntro);
    params.resetUrls.forEach((url, i) => lines.push("", c.accountLabel(i + 1), url));
  }
  lines.push("", c.outro);
  return { subject: CATALOGS[locale].prefix + c.subject, text: lines.join("\n") };
}

/** 退会の申請を受け付けたときのメール。 */
export function withdrawalRequestedContent(locale: Locale, params: { settingsUrl: string; scheduledPurgeAt: number }): SystemMailContent {
  const c = CATALOGS[locale].withdrawal;
  return {
    subject: CATALOGS[locale].prefix + c.requested.subject,
    text: [
      c.requested.intro,
      "",
      c.purgeAtLine(formatJstDateTimeForLocale(params.scheduledPurgeAt, locale)),
      ...c.requested.afterPurge,
      "",
      ...c.retention,
      c.settingsLead,
      params.settingsUrl,
      "",
      ...c.requested.closing,
    ].join("\n"),
  };
}

/** 削除の7日前の再通知。 */
export function withdrawalReminderContent(locale: Locale, params: { settingsUrl: string; scheduledPurgeAt: number }): SystemMailContent {
  const c = CATALOGS[locale].withdrawal;
  return {
    subject: CATALOGS[locale].prefix + c.reminder.subject,
    text: [
      c.reminder.intro,
      "",
      c.purgeAtLine(formatJstDateTimeForLocale(params.scheduledPurgeAt, locale)),
      ...c.reminder.afterPurge,
      "",
      ...c.retention,
      c.settingsLead,
      params.settingsUrl,
    ].join("\n"),
  };
}

/** 削除が完了したときのメール。 */
export function withdrawalCompletedContent(locale: Locale): SystemMailContent {
  const c = CATALOGS[locale].withdrawal;
  return { subject: CATALOGS[locale].prefix + c.completed.subject, text: c.completed.body.join("\n") };
}
