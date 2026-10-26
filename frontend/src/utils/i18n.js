/**
 * Lightweight English ↔ Hindi UI dictionary.
 * Only the most visible strings are translated; anything untranslated falls
 * back to English so the UI never shows empty text.
 */
export const STRINGS = {
  // navbar
  'nav.courses': ['Courses', 'कोर्स'],
  'nav.notes': ['Notes', 'नोट्स'],
  'nav.quizzes': ['Quizzes', 'क्विज़'],
  'nav.coding.arena': ['Coding Arena', 'कोडिंग एरीना'],
  'nav.contests': ['Contests', 'प्रतियोगिता'],
  'nav.leaderboard': ['Leaderboard', 'लीडरबोर्ड'],
  'nav.about': ['About', 'हमारे बारे में'],
  'nav.contact': ['Contact', 'संपर्क'],
  'nav.login': ['Login', 'लॉगिन'],
  'nav.register': ['Sign up', 'साइन अप'],
  // landing
  'landing.eyebrow': ['College-level EdTech + Online Judge', 'कॉलेज-स्तरीय एडटेक + ऑनलाइन जज'],
  'landing.hero1': ['Learn.', 'सीखो।'],
  'landing.hero2': ['Code.', 'कोड करो।'],
  'landing.hero3': ['Compete.', 'मुकाबला करो।'],
  'landing.hero4': ['Grow.', 'आगे बढ़ो।'],
  'landing.cta_courses': ['📘 Explore Courses', '📘 कोर्स देखें'],
  'landing.cta_coding': ['💻 Start Coding', '💻 कोडिंग शुरू करें'],
  'landing.cta_live': ['📡 Join Live Quiz', '📡 लाइव क्विज़ जॉइन करें'],
  'landing.stats': ['Statistics', 'आँकड़े'],
  'landing.popular': ['Top courses right now', 'अभी के टॉप कोर्स'],
  'landing.notes_title': ['📄 Latest Notes', '📄 नवीनतम नोट्स'],
  'landing.quizzes_title': ['🧠 Upcoming Quizzes', '🧠 आगामी क्विज़'],
  'landing.contests_title': ['Live & upcoming contests', 'लाइव और आगामी प्रतियोगिताएँ'],
  'landing.problems_title': ['Practice problems', 'अभ्यास समस्याएँ'],
  'landing.top_users': ['Top performers this season', 'इस सीज़न के सर्वश्रेष्ठ'],
  'landing.cta_heading': ['Ready to level up your coding?', 'अपनी कोडिंग को अगले स्तर पर ले जाने के लिए तैयार?'],
  'landing.cta_sub': ['Enrol in a course, attempt quizzes, solve problems and climb the leaderboard.', 'कोर्स में नामांकन करें, क्विज़ दें, समस्याएँ हल करें और लीडरबोर्ड पर चढ़ें।'],
  'landing.create_account': ['Create free account', 'मुफ्त खाता बनाएँ'],
  'landing.go_dashboard': ['Go to dashboard', 'डैशबोर्ड पर जाएँ'],
  'landing.potd': ['⭐ Problem of the Day', '⭐ आज की समस्या'],
  'landing.solve_today': ['Solve today’s problem →', 'आज की समस्या हल करें →'],
  // common
  'common.solved': ['Solved', 'हल किया'],
  'common.view_all': ['View all →', 'सभी देखें →'],
};

export const translate = (lang, key, fallback) => {
  const entry = STRINGS[key];
  if (!entry) return fallback || key;
  return lang === 'hi' ? entry[1] : entry[0];
};
