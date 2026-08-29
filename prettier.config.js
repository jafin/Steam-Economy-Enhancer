/** @type {import('prettier').Config} */
export default {
  singleQuote: true,
  printWidth: 100,
  trailingComma: 'all',
  // Matches the repo's existing indentation, so the reformat commit is quote and
  // wrapping noise rather than a re-indent of every line.
  tabWidth: 4,
};
