export default {
  extends: ['@commitlint/config-conventional'],
  // ignore dependabot commits
  ignores: [(message) => /^Bumps \[.+]\(.+\) from .+ to .+\.$/m.test(message)],
};
