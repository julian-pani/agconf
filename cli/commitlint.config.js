export default {
  extends: ['@commitlint/config-conventional'],
  // ignore dependabot commits
  ignores: [(message) => /^Signed-off-by: dependabot\[bot]/m.test(message)],
};
