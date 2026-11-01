// The screen on the TV: shows the weekly codes and whether a phone is connected.
(function () {
  var he = (navigator.language || '').toLowerCase().indexOf('he') === 0;
  var TEXT = he ? {
    intro: 'כדי לשלוט בטלוויזיה הזו מכל מקום, פתח את האפליקציה בטלפון והקלד:',
    id: 'מזהה', password: 'סיסמה',
    online: 'מוכן לחיבור', connecting: 'מתחבר לשרת...', offline: 'אין חיבור לשרת. מנסה שוב...', starting: 'מתחיל...',
    peer: 'טלפון מחובר ושולט בטלוויזיה',
    valid: 'הפרטים מתחלפים לבד ב-', rotate: 'לחיצה על OK בשלט מחליפה את הפרטים עכשיו.',
    'tv-approve': 'אשר את הבקשה שעל המסך בעזרת השלט, כדי שהאפליקציה תוכל לשלוט בטלוויזיה.',
    'tv-refused': 'הטלוויזיה דחתה את הבקשה. פתח את האפליקציה שוב ואשר.',
    'tv-offline': 'אין גישה לממשק הטלוויזיה. מנסה שוב...', 'tv-ready': '',
  } : {
    intro: 'To control this TV from anywhere, open the app on your phone and type:',
    id: 'ID', password: 'Password',
    online: 'Ready to connect', connecting: 'Connecting to the server...', offline: 'No connection to the server. Trying again...', starting: 'Starting...',
    peer: 'A phone is connected and controlling this TV',
    valid: 'These change by themselves on ', rotate: 'Press OK on the remote to change them now.',
    'tv-approve': 'Accept the request on the screen with the remote, so this app can control the TV.',
    'tv-refused': 'The TV declined the request. Open this app again and accept.',
    'tv-offline': "Can't reach the TV's interface. Trying again...", 'tv-ready': '',
  };
  var $ = function (id) { return document.getElementById(id); };
  if (he) document.documentElement.dir = 'rtl';
  $('intro').textContent = TEXT.intro;
  $('id-label').textContent = TEXT.id;
  $('password-label').textContent = TEXT.password;
  $('rotate').textContent = TEXT.rotate;

  function group(text, size) {
    var parts = [];
    for (var i = 0; i < text.length; i += size) parts.push(text.substr(i, size));
    return parts.join(' ');
  }

  var adapter = window.createTvAdapter({
    storage: window.localStorage,
    onStatus: function (status) { $('tv-status').textContent = TEXT[status] || ''; $('tv-status').className = 'status bad'; },
  });

  var agent = new window.TvAgent({
    relay: window.TV_CONFIG.relay,
    adapter: adapter,
    storage: window.localStorage,
    onChange: function (state) {
      $('id').textContent = group(state.id, 3);
      $('password').textContent = group(state.password, 5);
      $('status').textContent = state.peer ? TEXT.peer : TEXT[state.status];
      $('status').className = 'status ' + (state.peer || state.status === 'online' ? 'good' : 'bad');
      $('valid').textContent = TEXT.valid + state.validUntil.toISOString().slice(0, 10);
    },
  });

  document.addEventListener('keydown', function (event) {
    if (event.keyCode === 13) agent.newCodes();
  });

  adapter.start();
  agent.start();
  window.tvAgent = agent;
}());
