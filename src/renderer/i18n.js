const STRINGS = {
  he: {
    switchTo: 'English',
    remote: 'שלט',
    powerOff: 'כיבוי הטלוויזיה',
    connectionState: 'מצב חיבור',
    volumeUp: 'הגבר',
    volumeDown: 'הנמך',
    volumeLabel: 'קול',
    mute: 'השתק',
    channelNext: 'ערוץ הבא',
    channelPrev: 'ערוץ קודם',
    channelLabel: 'ערוץ',
    volume: 'עוצמת קול',
    up: 'למעלה',
    left: 'שמאלה',
    right: 'ימינה',
    down: 'למטה',
    back: 'חזרה',
    home: 'בית',
    exit: 'יציאה',
    settings: 'הגדרות',
    guide: 'מדריך',
    info: 'מידע',
    red: 'אדום',
    green: 'ירוק',
    yellow: 'צהוב',
    blue: 'כחול',
    rewind: 'הרצה אחורה',
    play: 'נגן',
    pause: 'השהה',
    stop: 'עצור',
    fastForward: 'הרצה קדימה',
    frameAlt: 'תמונת מסך הטלוויזיה',
    connectTitle: 'חיבור לטלוויזיה',
    tvType: 'סוג הטלוויזיה',
    brandAuto: 'זיהוי אוטומטי',
    brandSony: 'Sony BRAVIA (עם מפתח)',
    appsCommonHint: 'הטלוויזיה לא מדווחת אילו אפליקציות מותקנות. אלו אפליקציות נפוצות, ומה שלא מותקן לא ייפתח.',
    viewUnsupported: 'הטלוויזיה הזו לא מאפשרת להציג את המסך שלה במחשב. השליטה עובדת, והתוצאה נראית על הטלוויזיה עצמה.',
    connectHint: 'המחשב והטלוויזיה צריכים להיות באותה רשת, או מחוברים דרך VPN.',
    tvAddress: 'כתובת הטלוויזיה',
    connect: 'התחבר',
    scan: 'חפש טלוויזיות ברשת',
    connectPin: 'התחבר עם קוד PIN',
    pinCode: 'קוד PIN',
    pinPlaceholder: 'הקוד שעל המסך',
    sendPin: 'שלח קוד',
    viewOff: 'התצוגה כבויה. אפשר לשלוט בטלוויזיה גם בלי לראות אותה כאן.',
    showScreen: 'הצג את המסך',
    stopScreen: 'הפסק להציג',
    lockHint: 'העכבר והמקלדת שולטים בטלוויזיה. קליק ימני: חזרה. Esc: שחרור. מיקום הסמן משוער: הפריט המודגש במסך הוא המדויק.',
    rate: 'קצב',
    rateFast: 'מהיר',
    rateNormal: 'רגיל',
    rateEconomy: 'חסכוני',
    lock: 'שלוט בעכבר ובמקלדת',
    screenOff: 'כבה רק את המסך',
    screenOn: 'הדלק את המסך',
    disconnect: 'התנתק',
    apps: 'אפליקציות',
    searchApps: 'חיפוש אפליקציה',
    inputs: 'מקורות',
    typing: 'הקלדה',
    typingHint: 'עובד כששדה טקסט פתוח בטלוויזיה.',
    textToSend: 'טקסט לשליחה',
    send: 'שלח',
    deleteChar: 'מחק תו',
    confirm: 'אישור',
    forget: 'שכח',
    wakeSent: 'נשלחה בקשת הדלקה. החיבור יתחדש כשהטלוויזיה תעלה.',
    enterAddressFirst: 'כתוב קודם את כתובת הטלוויזיה.',
    scanning: 'מחפש טלוויזיות...',
    scanNone: 'לא נמצאה טלוויזיה. בדוק שהיא דלוקה, או כתוב את הכתובת שלה מהגדרות הרשת.',
    scanFound: 'נמצאו {count}. בחר טלוויזיה.',
    connecting: 'מתחבר...',
    reconnecting: 'החיבור נותק. מנסה שוב...',
    pairingPin: 'כתוב כאן את הקוד שמופיע על מסך הטלוויזיה.',
    pairingPrompt: 'אשר את הבקשה על מסך הטלוויזיה בעזרת השלט.',
    pairingPsk: 'בטלוויזיה: הגדרות > רשת > הגדרות בית > בקרת IP. הגדר אימות "Normal and Pre-Shared Key", בחר מפתח וכתוב אותו כאן.',
    fps: '{value} תמונות בשנייה',
    captureBlocked: 'הטלוויזיה הזו חוסמת צילום מסך. השליטה ממשיכה לעבוד.',
    liveStopped: 'התצוגה הופסקה: {error}',
    errUNREACHABLE: 'לא הצלחתי להגיע לטלוויזיה. בדוק שהיא דלוקה ושהכתובת נכונה.',
    errPAIRING_TIMEOUT: 'לא התקבל אישור מהטלוויזיה. אשר את הבקשה על המסך ונסה שוב.',
    errPAIRING_REJECTED: 'הטלוויזיה דחתה את החיבור.',
    errNOT_CONNECTED: 'אין חיבור לטלוויזיה.',
    errTIMEOUT: 'הטלוויזיה לא ענתה בזמן.',
    errNO_IMAGE: 'הטלוויזיה לא החזירה תמונה.',
    errNO_MAC: 'אין דרך להדליק את הטלוויזיה הזו מכאן, או שכתובת ה-MAC עוד לא ידועה. התחבר פעם אחת כשהיא דולקת.',
    errNOT_DETECTED: 'לא נמצאה בכתובת הזו טלוויזיה נתמכת. בדוק שהיא דלוקה, או בחר את הסוג ידנית.',
    errBAD_PIN: 'הקוד לא נכון. נסה שוב.',
    errCONTROL_DISABLED: 'השליטה ברשת כבויה בטלוויזיה. ב-Roku: הגדרות > מערכת > הגדרות מערכת מתקדמות > שליטה מאפליקציות, והפעל.',
    errUNSUPPORTED: 'הטלוויזיה הזו לא תומכת בפעולה הזו.',
  },
  en: {
    switchTo: 'עברית',
    remote: 'Remote',
    powerOff: 'Turn off the TV',
    connectionState: 'Connection state',
    volumeUp: 'Volume up',
    volumeDown: 'Volume down',
    volumeLabel: 'Vol',
    mute: 'Mute',
    channelNext: 'Next channel',
    channelPrev: 'Previous channel',
    channelLabel: 'CH',
    volume: 'Volume',
    up: 'Up',
    left: 'Left',
    right: 'Right',
    down: 'Down',
    back: 'Back',
    home: 'Home',
    exit: 'Exit',
    settings: 'Settings',
    guide: 'Guide',
    info: 'Info',
    red: 'Red',
    green: 'Green',
    yellow: 'Yellow',
    blue: 'Blue',
    rewind: 'Rewind',
    play: 'Play',
    pause: 'Pause',
    stop: 'Stop',
    fastForward: 'Fast forward',
    frameAlt: 'Picture of the TV screen',
    connectTitle: 'Connect to a TV',
    tvType: 'TV type',
    brandAuto: 'Detect automatically',
    brandSony: 'Sony BRAVIA (with a key)',
    appsCommonHint: "This TV doesn't report its installed apps. These are common ones, and an app that isn't installed won't open.",
    viewUnsupported: "This TV doesn't let a computer show its screen. Control works, and you see the result on the TV itself.",
    connectHint: 'The computer and the TV need to be on the same network, or connected through a VPN.',
    tvAddress: 'TV address',
    connect: 'Connect',
    scan: 'Search for TVs on the network',
    connectPin: 'Connect with a PIN',
    pinCode: 'PIN code',
    pinPlaceholder: 'The code on the TV',
    sendPin: 'Send code',
    viewOff: 'The view is off. You can still control the TV without seeing it here.',
    showScreen: 'Show screen',
    stopScreen: 'Stop showing',
    lockHint: 'Your mouse and keyboard now control the TV. Right click: back. Esc: release. The pointer position is estimated: the highlighted item on the TV is exact.',
    rate: 'Rate',
    rateFast: 'Fast',
    rateNormal: 'Normal',
    rateEconomy: 'Economy',
    lock: 'Control with mouse and keyboard',
    screenOff: 'Turn off screen only',
    screenOn: 'Turn on screen',
    disconnect: 'Disconnect',
    apps: 'Apps',
    searchApps: 'Search apps',
    inputs: 'Inputs',
    typing: 'Typing',
    typingHint: 'Works when a text field is open on the TV.',
    textToSend: 'Text to send',
    send: 'Send',
    deleteChar: 'Delete character',
    confirm: 'Confirm',
    forget: 'Forget',
    wakeSent: 'Wake request sent. The app will connect when the TV is up.',
    enterAddressFirst: 'Type the TV address first.',
    scanning: 'Searching for TVs...',
    scanNone: 'No TV found. Check that it is on, or type its address from its network settings.',
    scanFound: 'Found {count}. Choose a TV.',
    connecting: 'Connecting...',
    reconnecting: 'Connection lost. Trying again...',
    pairingPin: 'Type the code shown on the TV screen.',
    pairingPrompt: 'Accept the request on the TV screen with its remote.',
    pairingPsk: 'On the TV: Settings > Network > Home network > IP control. Set authentication to "Normal and Pre-Shared Key", choose a key and type it here.',
    fps: '{value} pictures per second',
    captureBlocked: 'This TV blocks screenshots. Control keeps working.',
    liveStopped: 'The view stopped: {error}',
    errUNREACHABLE: "Can't reach the TV. Check that it is on and the address is correct.",
    errPAIRING_TIMEOUT: 'The TV did not approve in time. Accept the request on the screen and try again.',
    errPAIRING_REJECTED: 'The TV declined the connection.',
    errNOT_CONNECTED: 'Not connected to the TV.',
    errTIMEOUT: 'The TV did not answer in time.',
    errNO_IMAGE: 'The TV did not return a picture.',
    errNO_MAC: "This TV can't be turned on from here, or its MAC address isn't known yet. Connect once while it is on.",
    errNOT_DETECTED: 'No supported TV answered at this address. Check that it is on, or choose the type by hand.',
    errBAD_PIN: 'The code is not correct. Try again.',
    errCONTROL_DISABLED: 'Network control is turned off on the TV. On a Roku: Settings > System > Advanced system settings > Control by mobile apps, and enable it.',
    errUNSUPPORTED: "This TV doesn't support that action.",
  },
};

function loadLanguage() {
  try {
    const saved = localStorage.getItem('language');
    if (STRINGS[saved]) return saved;
  } catch {
    // Storage can be unavailable; fall through to the system language.
  }
  return navigator.language.toLowerCase().startsWith('he') ? 'he' : 'en';
}

let language = loadLanguage();

function t(key, params = {}) {
  let text = STRINGS[language][key] ?? key;
  for (const [name, value] of Object.entries(params)) text = text.replace(`{${name}}`, value);
  return text;
}

// Messages written by the TV have no translation, so they are shown as received.
function errorText({ code, error }) {
  const key = `err${code}`;
  return STRINGS[language][key] ? t(key) : error;
}

function applyLanguage() {
  document.documentElement.lang = language;
  document.documentElement.dir = language === 'he' ? 'rtl' : 'ltr';
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
  for (const el of document.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const el of document.querySelectorAll('[data-i18n-alt]')) el.alt = t(el.dataset.i18nAlt);
}

function setLanguage(next) {
  language = next;
  try {
    localStorage.setItem('language', next);
  } catch {
    // The choice then lasts only for this session.
  }
  applyLanguage();
}
