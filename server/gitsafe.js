// One place for the flags every git invocation of the station gets. A project's .git/config (or a cloned
// repository) is untrusted: it could name a program in core.fsmonitor, core.hooksPath, diff.external or an
// ext:: transport and have the station run it just by listing the project. These -c flags override it.
//   core.fsmonitor=false       – git status/diff would run the configured fsmonitor command
//   core.hooksPath=<null dev>  – no repository hooks (pre-commit, post-checkout…) run from the station
//   diff.external=             – no external diff program
//   protocol.ext.allow=never   – no ext:: remotes (arbitrary command as a transport)
//   --literal-pathspecs        – a requested path is a path, never ":(top)", ":(glob)" magic
// core.sshCommand is NOT blanked globally (it would break every push over ssh); network commands use
// sshGuard() in gitpanel.js, which replaces a repository-local value only.
export const NULL_DEVICE = process.platform === "win32" ? "NUL" : "/dev/null";
export const GIT_HARDEN = [
  "--literal-pathspecs",
  "-c", "core.fsmonitor=false",
  "-c", `core.hooksPath=${NULL_DEVICE}`,
  "-c", "diff.external=",
  "-c", "protocol.ext.allow=never",
];
export const gitArgs = (args) => [...GIT_HARDEN, ...args];
