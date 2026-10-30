/** Starting points for new documents. All content is plain editor HTML (no external resources). */
const p = (t) => `<p>${t}</p>`;

export const TEMPLATES = [
  {
    id: 'blank',
    label: 'Blank document',
    description: 'An empty page.',
    title: 'Untitled document',
    html: '<p></p>',
  },
  {
    id: 'letter',
    label: 'Letter',
    description: 'A formal letter with sender, date, recipient and closing.',
    title: 'Letter',
    html: [p('Your name<br>Street address<br>City, State ZIP'), p('Date'), p('Recipient name<br>Street address<br>City, State ZIP'), p('Dear Recipient,'), p('Write the opening of your letter here. State the purpose clearly in the first paragraph.'), p('Add the details in the next paragraphs.'), p('Sincerely,'), p('Your name')].join(''),
  },
  {
    id: 'meeting',
    label: 'Meeting notes',
    description: 'Agenda, discussion, decisions and action items.',
    title: 'Meeting notes',
    html: '<h1>Meeting notes</h1><p><strong>Date:</strong> </p><p><strong>Attendees:</strong> </p><h2>Agenda</h2><ul><li><p>Topic one</p></li><li><p>Topic two</p></li></ul><h2>Discussion</h2><p></p><h2>Decisions</h2><ul><li><p></p></li></ul><h2>Action items</h2><ol><li><p>Owner: task, due date</p></li></ol>',
  },
  {
    id: 'resume',
    label: 'Résumé',
    description: 'A one-page résumé with experience, education and skills.',
    title: 'Résumé',
    html: '<h1 style="text-align: center">Your Name</h1><p style="text-align: center">City, State · email@example.com · (555) 555-0100</p><h2>Summary</h2><p>Two or three sentences about your experience and what you are looking for.</p><h2>Experience</h2><h3>Job title, Company</h3><p><em>Month Year – Month Year</em></p><ul><li><p>Achievement with a measurable result</p></li><li><p>Responsibility or project</p></li></ul><h2>Education</h2><p><strong>Degree</strong>, School, Year</p><h2>Skills</h2><p>Skill one · Skill two · Skill three</p>',
  },
  {
    id: 'report',
    label: 'Report',
    description: 'Title, summary, sections and conclusion.',
    title: 'Report',
    html: '<h1>Report title</h1><p><em>Author · Date</em></p><h2>Summary</h2><p>Summarise the main findings in a short paragraph.</p><h2>Background</h2><p></p><h2>Findings</h2><p></p><h2>Conclusion</h2><p></p>',
  },
  {
    id: 'plan',
    label: 'Project plan',
    description: 'Goals, scope, timeline table and risks.',
    title: 'Project plan',
    html: '<h1>Project plan</h1><h2>Goals</h2><ul><li><p>Goal one</p></li></ul><h2>Scope</h2><p></p><h2>Timeline</h2><table><tbody><tr><th><p>Milestone</p></th><th><p>Owner</p></th><th><p>Date</p></th></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td></tr></tbody></table><h2>Risks</h2><ul><li><p></p></li></ul>',
  },
];

export function getTemplate(id) {
  return TEMPLATES.find((t) => t.id === id) || TEMPLATES[0];
}
