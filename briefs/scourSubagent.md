# How this brief reaches you

You are a subagent started by a scour session. The brief below was written for a `claude -p` job, so read these
lines as overriding it wherever the two disagree:

- **The frozen tree is `{{tree}}`.** Wherever the brief says your working directory is the tree's root, read it as
  that directory: open files by their full path under it, and cite paths relative to it. Run git only as
  `git -C {{tree}} log|show|diff|blame …`. Never edit anything under it.
- **Write your answer to `{{out}}`**, a full path, with the Write tool (and Edit, to add to it). It is the only file
  you may write.
{{instructions}}
- **Your reply is one line**: {{reply}}. Everything else goes in the file.

---

