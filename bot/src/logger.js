const MAX = 500;
const entries = [];

function add(level, message) {
  const entry = {
    ts:      new Date().toISOString(),
    level,
    message: String(message)
  };
  entries.unshift(entry);
  if (entries.length > MAX) entries.pop();

  const prefix = `[${entry.ts}] [${level}]`;
  if (level === 'ERROR') console.error(prefix, message);
  else                   console.log(prefix, message);
}

module.exports = {
  info:    (m) => add('INFO',    m),
  warn:    (m) => add('WARN',    m),
  error:   (m) => add('ERROR',   m),
  success: (m) => add('SUCCESS', m),
  getLogs: (limit = 100) => entries.slice(0, limit)
};
