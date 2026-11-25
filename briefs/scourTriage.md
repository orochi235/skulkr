## For triage

This review is one of a scour's repeated reviews, and its findings go on to be fixed. Give every finding these lines
as well, after its `severity:` line:

    - fix: the files a fix would touch, comma-separated, where they differ from `where`
    - size: line | function | design — how far the fix reaches: a line or two, one function, or a change of design
    - cause: the root cause in a few words ("unclamped index", "stale cache key"), when you can see it
    - confidence: sure | likely — `sure` when you traced or ran it, `likely` when you reasoned to it
