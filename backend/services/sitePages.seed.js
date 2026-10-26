'use strict';
/**
 * Starter content for the public information pages.
 *
 * These are seeds, not law. Every page is editable from Admin → Site Pages so
 * an institution can drop in its own registered name, address, jurisdiction
 * and policy specifics. `{{site_name}}` and `{{contact_email}}` are expanded
 * at render time from Website Settings.
 */

const LEGAL_NOTE = 'This page is a starting point supplied with the platform. Review it with your institution\u2019s legal advisor and edit it from Admin \u2192 Site Pages before you go live.';

module.exports = [
  /* ------------------------------------------------------------------ FAQ */
  {
    slug: 'faq',
    title: 'Frequently asked questions',
    eyebrow: 'Help centre',
    summary: 'Quick answers about courses, quizzes, the coding arena, certificates and billing on {{site_name}}.',
    page_type: 'faq',
    footer_group: 'support',
    sort_order: 10,
    body: [
      {
        category: 'Getting started',
        items: [
          { q: 'How do I create an account?', a: 'Choose Create Account from the top navigation, enter your name, email and a password, then verify your email address. If your college issued you a sign-in link or a Google account, use that instead so your enrolments are mapped automatically.' },
          { q: 'I did not receive the verification or reset email.', a: 'Check your spam and promotions folders first. Mails are sent from the address configured by your administrator, so add it to your contacts. If nothing arrives within a few minutes, request the link again or write to {{contact_email}}.' },
          { q: 'Can I use {{site_name}} on a phone?', a: 'Yes. Courses, notes, quizzes and your dashboard work on any modern mobile browser. The coding arena needs a keyboard for a comfortable experience, so a laptop or desktop is recommended for programming practice and contests.' },
          { q: 'How do I change my password or email?', a: 'Open Settings from your profile menu. You can update your display details and password there. Changing a verified email address may require re-verification.' },
        ],
      },
      {
        category: 'Courses and study material',
        items: [
          { q: 'How do I enrol in a course?', a: 'Open the course page and select Enrol. Free courses start immediately. Premium courses require an active subscription or an enrolment granted by your institution.' },
          { q: 'Does my progress save automatically?', a: 'Yes. Lesson completion, quiz attempts and coding submissions are saved to your account as you go, so you can switch devices and continue where you left off.' },
          { q: 'Can I download notes for offline study?', a: 'Notes can be viewed in the browser and printed. Downloadable files are available where the instructor has attached them to a lesson.' },
        ],
      },
      {
        category: 'Quizzes, exams and integrity',
        items: [
          { q: 'What happens if my internet drops during a quiz?', a: 'Your answers are saved as you submit each question. Reconnect and reopen the quiz — if time remains on the attempt you can continue. If the attempt has expired, contact your instructor, who can review the attempt log.' },
          { q: 'Why did the screen go full-screen and block copy-paste?', a: 'Instructors can switch on exam integrity controls for an assessment. Depending on the settings these may include full-screen lockdown, blocked copy and paste, tab-switch monitoring and automated review of pasted or AI-generated text. The restrictions apply only while an attempt is in progress.' },
          { q: 'What counts as a violation?', a: 'Leaving the exam tab, exiting full-screen, attempting to copy question content or submitting work that is not your own may be recorded. Repeated violations can auto-submit an attempt. See our Code of Conduct for the full policy.' },
          { q: 'Can I retake a quiz?', a: 'That depends on how the instructor configured the quiz. The number of permitted attempts is shown on the quiz page before you begin.' },
        ],
      },
      {
        category: 'Coding arena and contests',
        items: [
          { q: 'Which programming languages are supported?', a: 'The languages enabled by your administrator are listed in the editor\u2019s language selector on every problem. Your solution is compiled and run against the problem\u2019s test cases in an isolated sandbox.' },
          { q: 'My solution passed the samples but failed on submit. Why?', a: 'Sample cases are only a subset. Submissions run against the full hidden test set, which includes edge cases and larger inputs, and must finish inside the problem\u2019s time and memory limits.' },
          { q: 'How is the contest leaderboard ranked?', a: 'Participants are ordered by score first, then by the time taken, then by who started earlier. Attempts still in progress are listed after completed ones.' },
        ],
      },
      {
        category: 'Certificates',
        items: [
          { q: 'When do I get a certificate?', a: 'Certificates are issued automatically when you meet the configured requirement — completing every lesson in a course, passing a quiz at the required score, placing in a contest, or reaching a coding milestone.' },
          { q: 'How can an employer verify my certificate?', a: 'Every certificate carries a unique certificate number and a public verification link. Anyone can open that link, or search the number on the Verify Certificate page, to confirm the credential without signing in.' },
          { q: 'Can I download my certificate as a PDF?', a: 'Yes. Open the certificate and choose Print / Download PDF, then save it as a PDF from your browser\u2019s print dialog.' },
        ],
      },
      {
        category: 'Payments, plans and refunds',
        items: [
          { q: 'What do I get with a paid plan?', a: 'Paid plans unlock premium courses, premium quizzes and premium coding problems, along with any additional benefits listed on the Pricing page for that plan.' },
          { q: 'Which payment methods are accepted?', a: 'Payments are processed by our payment gateway and support the methods it offers, typically UPI, debit and credit cards, net banking and wallets. {{site_name}} never stores your full card details.' },
          { q: 'How do I cancel, and will I be refunded?', a: 'You can cancel from the Subscription page at any time; access continues until the end of the paid period. Refund eligibility is set out in full on our Refund and Cancellation Policy page.' },
          { q: 'I was charged but my plan is not active.', a: 'Gateway confirmations occasionally arrive late. Refresh the Subscription page after a few minutes. If it is still inactive, write to {{contact_email}} with the payment reference and we will reconcile it.' },
        ],
      },
      {
        category: 'Account, data and support',
        items: [
          { q: 'How do I delete my account?', a: 'Write to {{contact_email}} from your registered email address. Some records tied to issued credentials or institutional reporting may be retained as described in our Privacy Policy.' },
          { q: 'Who can see my submissions and scores?', a: 'Your instructors and your institution\u2019s administrators can view your attempts, submissions and progress. Other learners only see what appears on public leaderboards.' },
          { q: 'How do I report a bug or a wrong question?', a: 'Use the Contact page, or write to {{contact_email}} with the page address and a screenshot. Reports about a specific quiz question should also be raised with your instructor.' },
        ],
      },
    ],
  },

  /* ---------------------------------------------------------------- terms */
  {
    slug: 'terms',
    title: 'Terms of use',
    eyebrow: 'Platform policy',
    summary: 'The rules that apply when you use {{site_name}}.',
    page_type: 'legal',
    footer_group: 'legal',
    sort_order: 20,
    body: [
      { heading: 'Acceptance of these terms', text: 'By creating an account on {{site_name}} or using any part of the platform you agree to these terms. If you are using the platform through an institution, your institution\u2019s own regulations apply in addition to these terms. If you do not agree, please stop using the platform.' },
      { heading: 'Who may use the platform', text: 'You must provide accurate registration details and keep them current. Accounts are personal and may not be shared, sold or transferred. If you are below the age of majority in your jurisdiction, you may use the platform only with the consent of a parent, guardian or your institution.' },
      { heading: 'Your account and security', text: 'You are responsible for everything done through your account and for keeping your password confidential. Tell us immediately at {{contact_email}} if you believe your account has been accessed without your permission. We may suspend an account where we reasonably suspect compromise or misuse.' },
      { heading: 'Acceptable use', text: 'Use {{site_name}} for lawful learning, assessment and programming activity only. You must not disrupt or overload the service, probe or bypass access controls, scrape content at scale, upload malware, run code intended to escape the execution sandbox, impersonate another person, or harass other users.' },
      { heading: 'Academic integrity', text: 'Work you submit must be your own unless collaboration is expressly permitted. Assessments may apply integrity controls, including full-screen lockdown, copy and paste restrictions, tab-switch monitoring, plagiarism comparison and automated analysis of pasted or AI-generated text. Findings are indicators for human review, not final determinations; your institution decides the outcome under its own policy.' },
      { heading: 'Content and intellectual property', text: 'Courses, notes, questions, problems and platform software remain the property of {{site_name}}, your institution or the respective creators. You receive a personal, non-transferable licence to access the material for your own learning. You may not republish, redistribute or commercially exploit it without written permission.' },
      { heading: 'Content you submit', text: 'You keep ownership of the work you upload, including code and written answers. You grant us the licence needed to store, display, evaluate and back up that work in order to operate the platform and to share it with your instructors and institution.' },
      { heading: 'Paid plans', text: 'Prices, inclusions and durations for paid plans are shown on the Pricing page. Payment, cancellation and refund terms are set out in our Refund and Cancellation Policy, which forms part of these terms.' },
      { heading: 'Certificates', text: 'Certificates confirm that the stated requirement was met on this platform. They are not a degree, diploma or statutory qualification unless your institution separately states otherwise. We may revoke a certificate issued in error or obtained through a breach of academic integrity.' },
      { heading: 'Availability and changes', text: 'We aim to keep the platform available but do not guarantee uninterrupted service. Features may be added, changed or withdrawn, and maintenance may require downtime. We will give reasonable notice of significant changes where we can.' },
      { heading: 'Suspension and termination', text: 'We may suspend or close an account that breaches these terms, puts other users at risk, or is required to be closed by your institution. You may close your account at any time by contacting {{contact_email}}.' },
      { heading: 'Limitation of liability', text: 'The platform is provided on an \u201cas is\u201d basis to the extent permitted by law. We are not liable for indirect or consequential loss, lost opportunity, or loss arising from your failure to keep your credentials secure. Nothing in these terms excludes liability that cannot lawfully be excluded.' },
      { heading: 'Changes to these terms', text: 'We may update these terms. The revision date below always reflects the current version, and continued use after an update means you accept the revised terms.' },
      { heading: 'Governing law and contact', text: 'These terms are governed by the laws of India, and the courts at the location of the operating institution have exclusive jurisdiction unless your institution specifies otherwise. Questions about these terms can be sent to {{contact_email}}.' },
    ],
  },

  /* -------------------------------------------------------------- privacy */
  {
    slug: 'privacy',
    title: 'Privacy policy',
    eyebrow: 'Data protection',
    summary: 'What {{site_name}} collects, why we collect it, and the control you have over it.',
    page_type: 'legal',
    footer_group: 'legal',
    sort_order: 30,
    body: [
      { heading: 'Scope', text: 'This policy explains how {{site_name}} handles personal information when you use the platform. Where you access the platform through an institution, that institution is the controller of your academic records and its own privacy notice applies alongside this one.' },
      { heading: 'Information you give us', text: 'Account details such as your name, email address, password hash, and optionally your college, phone number and profile photo. Anything you choose to send us through support channels is also stored with that enquiry.' },
      { heading: 'Information created as you learn', text: 'Enrolments, lesson progress, quiz attempts and answers, coding submissions and test results, contest participation, points, achievements and issued certificates. This is the record your instructors and institution use to assess you.' },
      { heading: 'Assessment integrity information', text: 'When an instructor enables integrity controls, an attempt may record tab-switch and full-screen events, blocked copy or paste actions, timing and typing telemetry, and the output of automated similarity or AI-text analysis. This is used only to support human review of that assessment.' },
      { heading: 'Technical information', text: 'Server logs record IP address, browser and device type, pages requested and timestamps. Cookies and similar storage keep you signed in and remember preferences such as your theme. See our Cookie Policy for the detail.' },
      { heading: 'Payment information', text: 'Subscription payments are processed by our payment gateway. We receive confirmation of the transaction, the plan purchased and a reference identifier. We do not receive or store your full card number, CVV or UPI credentials.' },
      { heading: 'How we use information', text: 'To create and secure your account, deliver courses and assessments, evaluate and grade your work, protect the integrity of exams, issue and verify certificates, process payments, provide support, meet institutional reporting obligations, and improve the platform.' },
      { heading: 'Legal bases', text: 'We process information to perform our contract with you, to meet our legal obligations, with your consent where consent is required, and in our legitimate interests in operating a secure and reliable learning platform.' },
      { heading: 'Who we share it with', text: 'Your instructors and your institution\u2019s administrators. Service providers who host the platform, deliver email, execute code in a sandbox, and process payments, each bound to act only on our instructions. Authorities where disclosure is legally required. We do not sell your personal information or share it for third-party advertising.' },
      { heading: 'What is public', text: 'Leaderboards may display your name, avatar and score. A certificate you have been issued can be confirmed by anyone holding its verification link or certificate number. Nothing else is public by default.' },
      { heading: 'Retention', text: 'Account and learning records are kept while your account is active and for as long as your institution requires them for academic and audit purposes. Certificate records are retained so that credentials stay verifiable. Technical logs are kept for a short operational period and then deleted or anonymised.' },
      { heading: 'Security', text: 'Passwords are stored only as salted hashes. Access to administrative functions is permission-controlled, transport is encrypted in transit, and submitted code is executed in an isolated sandbox. No system is perfectly secure, so please use a strong, unique password.' },
      { heading: 'Your rights', text: 'You can access and correct most details from Settings. You may also request a copy of your data, correction, deletion, or restriction of processing by writing to {{contact_email}} from your registered address. Some records linked to issued credentials or institutional reporting may be retained where we are required to keep them.' },
      { heading: 'Children', text: 'The platform is intended for learners in higher and senior-secondary education. Where it is used by minors, it is provided through an institution that has obtained the necessary parental or guardian consent.' },
      { heading: 'Changes and contact', text: 'We will update this policy as the platform evolves and will revise the date below when we do. For any privacy question or request, write to {{contact_email}}.' },
    ],
  },

  /* --------------------------------------------------------------- refund */
  {
    slug: 'refund',
    title: 'Refund and cancellation policy',
    eyebrow: 'Billing',
    summary: 'How subscription cancellations and refunds work on {{site_name}}.',
    page_type: 'legal',
    footer_group: 'legal',
    sort_order: 40,
    body: [
      { heading: 'Scope', text: 'This policy covers subscription plans bought directly on {{site_name}}. Fees paid to an institution through its own admission or examination process are governed by that institution\u2019s refund rules, not this page.' },
      { heading: 'Cancelling a subscription', text: 'You can cancel at any time from the Subscription page in your account. Cancellation stops the next renewal; it does not end the period you have already paid for. Your premium access continues until the end of that period, after which the account reverts to the free tier.' },
      { heading: 'Cooling-off refund', text: 'If you cancel within 7 days of a first-time purchase and have consumed only a small part of the plan, you may request a full refund. Substantial consumption — for example completing a significant share of a premium course, or being issued a certificate — means the plan has been delivered and the cooling-off refund no longer applies.' },
      { heading: 'Renewals', text: 'Renewal charges are not automatically refundable. If a renewal was taken in error and you have not used the service in the new period, write to us within 7 days of the charge and we will review it.' },
      { heading: 'Duplicate and failed payments', text: 'A duplicate charge for the same plan is refunded in full. If money left your account but the plan did not activate, send the payment reference to {{contact_email}}; we will reconcile it and either activate the plan or refund it.' },
      { heading: 'Service failure', text: 'If a paid feature is unavailable for a prolonged period because of a fault on our side and we cannot restore it, we will extend your plan for the lost time or issue a pro-rata refund, whichever you prefer.' },
      { heading: 'What is not refundable', text: 'Plans cancelled after substantial use, periods already elapsed, accounts suspended for a breach of these terms or of academic integrity, and promotional or free-trial access that carried no charge.' },
      { heading: 'How to request a refund', text: 'Write to {{contact_email}} from your registered email address with the payment reference, the plan name and the reason for the request. We acknowledge requests within 3 working days.' },
      { heading: 'How refunds are paid', text: 'Approved refunds are returned to the original payment method through our payment gateway. Gateway and bank processing usually completes within 5 to 10 working days; the exact timing is set by your bank. Refunds are not paid in cash or to a different account.' },
      { heading: 'Disputes', text: 'If you are unhappy with a refund decision, reply to the same email thread and ask for it to be escalated. Please raise the matter with us before initiating a chargeback so that we have the chance to resolve it.' },
    ],
  },

  /* -------------------------------------------------------------- cookies */
  {
    slug: 'cookies',
    title: 'Cookie policy',
    eyebrow: 'Data protection',
    summary: 'The cookies and browser storage {{site_name}} uses, and why.',
    page_type: 'legal',
    footer_group: 'legal',
    sort_order: 50,
    body: [
      { heading: 'What cookies are', text: 'Cookies and similar browser storage are small pieces of data a site keeps on your device so it can recognise you between requests. {{site_name}} uses them sparingly and only for the purposes described here.' },
      { heading: 'Strictly necessary', text: 'These keep you signed in, carry your session and access token, protect forms against cross-site request forgery, and apply rate limiting. The platform cannot work without them, so they are not optional.' },
      { heading: 'Preferences', text: 'These remember choices such as light or dark theme, your preferred programming language in the editor, and layout settings like split-pane widths. Clearing them simply returns the platform to its defaults.' },
      { heading: 'Assessment integrity', text: 'During an exam with integrity controls enabled, short-lived storage records attempt state and violation counters so that a reload does not wipe your progress or reset the counters. This storage is cleared when the attempt finishes.' },
      { heading: 'Analytics and advertising', text: 'We do not use advertising cookies and we do not share browsing data with advertising networks. If your institution enables an analytics tool, it will be named here before it is switched on.' },
      { heading: 'Managing cookies', text: 'You can clear or block cookies in your browser settings. Blocking strictly necessary cookies will sign you out and prevent assessments from running correctly. Preference storage can be cleared at any time without losing your account data.' },
      { heading: 'Questions', text: 'For anything about cookies or browser storage on this platform, write to {{contact_email}}.' },
    ],
  },

  /* ----------------------------------------------------- code of conduct */
  {
    slug: 'code-of-conduct',
    title: 'Code of conduct and academic integrity',
    eyebrow: 'Community standards',
    summary: 'What we expect from every learner, instructor and administrator on {{site_name}}.',
    page_type: 'legal',
    footer_group: 'legal',
    sort_order: 60,
    body: [
      { heading: 'Our standard', text: 'Everyone on {{site_name}} is entitled to a respectful, safe and fair learning environment. This code applies to coursework, assessments, contests, discussion and any contact you have with other users or staff through the platform.' },
      { heading: 'Respectful conduct', text: 'Treat others courteously. Harassment, discrimination, threats, hate speech, doxxing and deliberately disruptive behaviour are not tolerated, in any language and in any part of the platform.' },
      { heading: 'Honest work', text: 'Submit only work you produced yourself, unless the instructor has expressly allowed collaboration. Do not copy another learner\u2019s answers, buy or sell solutions, use an unauthorised AI assistant where it is prohibited, or present generated text or code as your own.' },
      { heading: 'Assessment conduct', text: 'During an assessment, do not switch to other applications or tabs, leave full-screen, use a second device, photograph or screenshot questions, communicate with anyone, or attempt to disable the integrity controls.' },
      { heading: 'Platform integrity', text: 'Do not share accounts or credentials, attempt to access another user\u2019s data, bypass permission checks, interfere with the code execution sandbox, or publish question banks and problem sets outside the platform.' },
      { heading: 'How concerns are reviewed', text: 'Automated signals such as similarity scores, AI-text indicators and violation counts flag an attempt for human review. They are never the sole basis for a decision. An instructor or administrator examines the attempt in context before any action is taken.' },
      { heading: 'Possible outcomes', text: 'Depending on severity and your institution\u2019s own regulations, outcomes may include a warning, cancellation of an attempt, a mark of zero for the assessment, revocation of a certificate, suspension of platform access, or referral to your institution for disciplinary action.' },
      { heading: 'Reporting and appeals', text: 'Report conduct concerns to your instructor or to {{contact_email}}. If a decision has been taken about your work and you believe it is wrong, you may appeal through your institution\u2019s academic process; the platform will supply the underlying attempt record for that review.' },
    ],
  },

  /* ----------------------------------------------------------- disclaimer */
  {
    slug: 'disclaimer',
    title: 'Disclaimer',
    eyebrow: 'Legal notice',
    summary: 'The limits of what {{site_name}} content and credentials represent.',
    page_type: 'legal',
    footer_group: 'legal',
    sort_order: 70,
    body: [
      { heading: 'Educational purpose', text: 'All courses, notes, questions, problems and solutions on {{site_name}} are provided for education and practice. They are not professional, legal, financial, medical or engineering advice, and should not be relied on as such.' },
      { heading: 'Accuracy of content', text: 'We work to keep material correct and current, but we do not warrant that it is free of errors or omissions, or that it reflects the latest syllabus, standard or language version. If you spot a mistake, please report it so we can correct it.' },
      { heading: 'Certificates and outcomes', text: 'A certificate records that a specific requirement was met on this platform. It is not a degree, diploma or statutory qualification unless your institution expressly states otherwise, and it is not a guarantee of employment, placement, admission or examination success.' },
      { heading: 'Automated assessment signals', text: 'Similarity checks, AI-text analysis and integrity telemetry are probabilistic indicators intended to support human review. They can produce false positives and false negatives, and no decision about a learner should rest on them alone.' },
      { heading: 'Code execution', text: 'Submitted code runs in a sandbox with time and memory limits. Results depend on the test data, limits and language runtime configured for each problem, and may differ from what you observe on your own machine.' },
      { heading: 'External links', text: 'The platform may link to third-party sites and resources. We do not control them and are not responsible for their content, availability or privacy practices.' },
      { heading: 'Availability', text: 'The platform is provided on an \u201cas is\u201d and \u201cas available\u201d basis. We do not warrant uninterrupted or error-free operation, and scheduled maintenance may make features temporarily unavailable.' },
    ],
  },

  /* -------------------------------------------------------- accessibility */
  {
    slug: 'accessibility',
    title: 'Accessibility statement',
    eyebrow: 'Inclusion',
    summary: 'How {{site_name}} works towards an interface everyone can use.',
    page_type: 'legal',
    footer_group: 'support',
    sort_order: 80,
    body: [
      { heading: 'Our commitment', text: '{{site_name}} aims to be usable by every learner, including those who rely on assistive technology. We work towards the WCAG 2.1 Level AA guidelines as our reference standard.' },
      { heading: 'What is in place', text: 'Semantic headings and landmark regions, a skip-to-content link, keyboard access to navigation and forms, visible focus outlines, labelled form fields and switches, alternative text on meaningful images, and a light and dark theme with contrast-checked colour tokens.' },
      { heading: 'Known limitations', text: 'The code editor and the certificate print view are visually dense and are best used with a keyboard and a larger screen. Some third-party embedded content may not meet the same standard. Complex data tables are easier to read on a wider viewport.' },
      { heading: 'Assessment accommodations', text: 'Extra time, alternative formats and other reasonable adjustments for an assessment are arranged by your institution. Instructors can configure attempt duration and integrity settings per assessment, so raise accommodation requests with them before the exam.' },
      { heading: 'Tell us about a barrier', text: 'If any part of the platform blocks you, write to {{contact_email}} with the page address, what you were trying to do and the assistive technology you use. We treat accessibility reports as priority defects and will tell you the outcome.' },
    ],
  },
];
