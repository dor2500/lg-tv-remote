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
    connectTitle: 'חיבור לטלוויזיית LG',
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
    fps: '{value} תמונות בשנייה',
    captureBlocked: 'הטלוויזיה הזו חוסמת צילום מסך. השליטה ממשיכה לעבוד.',
    liveStopped: 'התצוגה הופסקה: {error}',
    errUNREACHABLE: 'לא הצלחתי להגיע לטלוויזיה. בדוק שהיא דלוקה ושהכתובת נכונה.',
    errPAIRING_TIMEOUT: 'לא התקבל אישור מהטלוויזיה. אשר את הבקשה על המסך ונסה שוב.',
    errPAIRING_REJECTED: 'הטלוויזיה דחתה את החיבור.',
    errNOT_CONNECTED: 'אין חיבור לטלוויזיה.',
    errTIMEOUT: 'הטלוויזיה לא ענתה בזמן.',
    errNO_IMAGE: 'הטלוויזיה לא החזירה תמונה.',
    errNO_MAC: 'כתובת ה-MAC עוד לא ידועה. התחבר פעם אחת כשהטלוויזיה דולקת.',
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
    connectTitle: 'Connect to an LG TV',
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
    fps: '{value} pictures per second',
    captureBlocked: 'This TV blocks screenshots. Control keeps working.',
    liveStopped: 'The view stopped: {error}',
    errUNREACHABLE: "Can't reach the TV. Check that it is on and the address is correct.",
    errPAIRING_TIMEOUT: 'The TV did not approve in time. Accept the request on the screen and try again.',
    errPAIRING_REJECTED: 'The TV declined the connection.',
    errNOT_CONNECTED: 'Not connected to the TV.',
    errTIMEOUT: 'The TV did not answer in time.',
    errNO_IMAGE: 'The TV did not return a picture.',
    errNO_MAC: "The TV's MAC address isn't known yet. Connect once while the TV is on.",
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
