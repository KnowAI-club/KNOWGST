// Product-owned help routing; financial helpers remain unchanged.
export const DOCS_URL = '/docs/';
export const docsLink = (doc = '') => {
  const [topic, section] = doc.split('#');
  return `${DOCS_URL}${topic ? `?topic=${encodeURIComponent(topic)}` : ''}${section ? `#${encodeURIComponent(section)}` : ''}`;
};
