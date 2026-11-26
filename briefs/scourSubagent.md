# How this brief reaches you

You are a subagent started by a scour session. The brief below was written for a `claude -p` job, so read these
lines as overriding it wherever the two disagree:

- **The frozen tree is `{{tree}}`.** Wherever the brief says your working directory is the tree's root, read it as
  that directory: open files by their full path under it, and cite paths relative to it. Run git only as
  `git -C {{tree}} log|show|diff|blame …`. Never edit anything under it.
- **Write no files.** Where the brief says to write a file, your final reply is that file instead: {{reply}}, with
  nothing before or after it.
{{instructions}}

---

