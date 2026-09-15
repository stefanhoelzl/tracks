# Running IntelliJ's J2K headless: which build, under which terms

_Reviewed 2026-09-15, for BRouter's conversion to Kotlin (M10). Not legal advice; the quotes are
the documents' own words, the readings are marked as readings._

## Answer

**Permitted either way, and the open-source build is the one to use.**

The spike converted BRouter with `idea-2026.2.2.tar.gz` from `download.jetbrains.com`, the
unified distribution, run headless in a container with no licence. Nothing in its terms forbids
that. But JetBrains also publishes an **Apache-2.0 open-source build of the same version**, and
that build carries no use restrictions at all, may be cached and baked into images, and is about
740 MB smaller. The J2K converter is part of it. So the pipeline moves to it, and the unified
tarball stays the fallback.

Two files share the name `idea-2026.2.2.tar.gz`; they are not the same product:

| | unified distribution | open-source build |
|---|---|---|
| where | `download.jetbrains.com/idea/idea-2026.2.2.tar.gz` | [GitHub release `idea/2026.2.2`](https://github.com/JetBrains/intellij-community/releases/tag/idea/2026.2.2), published 2026-09-02 |
| size | 1,606,104,586 bytes | 867,478,675 bytes |
| terms | JetBrains User Agreement 2.0 | JetBrains Open-Source Build Terms 1.3 (Apache 2.0) |
| cache it in CI, bake it into an image | not clearly allowed (see §3.5(d)) | allowed |

**Shown, not assumed:** the open-source build converts BRouter to the same Kotlin. `convert.sh`
run against it (2026-09-15) produced 101 files, 0 unresolved references, and a tree identical
to the one the unified build produced during the spike — `diff -r` finds no difference — so the
fix passes apply unchanged and `replay.sh --check` passes. J2K lives in
`plugins/kotlin/j2k/k2` of the same tag, which is why.

## The unified distribution

[JetBrains User Agreement, version 2.0, effective 16 April 2025](https://www.jetbrains.com/legal/docs/toolbox/user/),
accepted by use:

- §3.1: "You may install the Product on Your Machine free of charge", a Machine being "a
  computing device used by You for running the Product".
- §3.2: "You may use the Product for free for any commercial or non-commercial purposes … in the
  freemium mode". A subscription is needed only "to use all features" (§3.3). J2K is a free
  feature.
- §3.5 prohibits, without written permission: reverse-engineering or decompiling (b); creating
  derivative works of the Product (c); providing "the Product or access to the Product to any
  third party" (d); avoiding fees by "overcoming technical restrictions" (e); building a competing
  product (f).
- §4.2: "You retain ownership of all … rights to data that You transfer to or create in the
  Product." The converted Kotlin is ours — a derivative of MIT-licensed BRouter, so BRouter's
  notice travels with it.
- §5: "We do not see or have access to Your data in the Product by default." Usage statistics
  are opt-in.
- §9: JetBrains may change the agreement, and continued use accepts the change.

JetBrains' own summary of the unified release: "Using IntelliJ IDEA for free does not require any
authorizations or activations"
([blog, December 2025](https://blog.jetbrains.com/idea/2025/12/intellij-idea-unified-release/)).

**Readings, not quotes.** No clause mentions headless use, containers or CI. A container or runner
we operate is "a computing device used by You". A plugin built on the published
`ApplicationStarter` API is ordinary use, not modification or reverse engineering. What would be a
problem is §3.5(d): a public image, an Actions cache readable by forks, or a release asset holding
the unified IDE, or offering the conversion to others as a service.

## The open-source build

[JetBrains Open-Source Build Terms, version 1.3, effective 15 June 2026](https://github.com/JetBrains/intellij-community/blob/idea/2026.2.2/LICENSE.txt)
(checked against the `idea/2026.2.2` tag): the builds "consist of open source software subject to
the Apache 2.0 License". They may send product version, edition and OS information with a unique
ID; anything further is opt-in. They exclude a list of proprietary plugins (AI, Code With Me, LSP,
Kotlin Notebook, Qodana, Package Checker, localization, Backup and Sync); J2K is not on it.

JetBrains builds it from `.github/workflows/IntelliJ_IDEA.yml` on every `idea/20*` tag, for
x86_64 and aarch64. Building it ourselves is possible but not needed: JetBrains Runtime 25, Bazel
(the README calls the migration's rough edges out), at least 8 GB of RAM, and
`docker build . --target intellij_idea` or `./installers.cmd`.

## What the pipeline does with this

- `convert.sh` downloads the open-source `idea-<version>.tar.gz` from the GitHub release and
  checks its sha256, pinned in the script. The unified download stays behind a switch, as the
  fallback.
- The IDE runs only on machines we control, for this repository, with usage statistics left
  unconsented — which is how the spike already ran it.
- Conversion stays a local, per-release step. Its output is committed, so CI never needs the IDE
  (change 2).

## Sources

- https://www.jetbrains.com/legal/docs/toolbox/user/
- https://www.jetbrains.com/legal/docs/toolbox/user_community/ (the discontinued Community Edition's terms)
- https://www.jetbrains.com/legal/docs/toolbox/license_non-commercial/ (not applicable: no licence is activated)
- https://github.com/JetBrains/intellij-community/blob/idea/2026.2.2/LICENSE.txt
- https://github.com/JetBrains/intellij-community/releases/tag/idea/2026.2.2
- https://blog.jetbrains.com/idea/2025/11/intellij-idea-open-source/
- https://blog.jetbrains.com/idea/2025/12/intellij-idea-unified-release/
- https://lp.jetbrains.com/intellij-idea-unified-faq/
- https://www.jetbrains.com/help/idea/command-line-code-inspector.html (headless `inspect`, no licence requirement mentioned)
