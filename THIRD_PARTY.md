# Third-party resources and distribution

Reviewed 2026-09-22. This is a resource inventory, not legal advice or a warranty
that a particular deployment complies with every applicable license.

## Scope of Apache-2.0

[LICENSE](LICENSE) applies to original Phonetics Lab code and original authored
practice material. Third-party assets and dependencies retain their own terms.
Free to download does not mean unrestricted, commercially usable, or freely
redistributable. Installing at runtime does not remove those obligations.

Do not add a noncommercial restriction to the Apache license itself. Instead,
keep separately licensed resources identifiable and retain their notices. A
commercial fork must independently clear, replace, or exclude restricted resources.

## Installed dictionary resources

| Resource | Upstream terms | Installation |
| --- | --- | --- |
| [CMUdict](https://github.com/cmusphinx/cmudict) | [BSD-style license](https://github.com/cmusphinx/cmudict/blob/74790861f652b15e4ac49015a90074ad62a27690/LICENSE); retain copyright, conditions and disclaimer | Downloaded and converted to IPA locally. Upstream notice saved alongside the generated table. |
| [google-10000-english](https://github.com/first20hours/google-10000-english) | [Publisher's usage statement](https://github.com/first20hours/google-10000-english/blob/d0736d492489198e4f9d650c7ab4143bc14c1e9e/LICENSE.md) describes personal/educational/research use and warns against commercial use without licensing the underlying corpus. This is not a blanket MIT license for the data. | Explicit personal/research-use acknowledgment required. Commercial rights are not cleared by this project. |

The current full application/checks use both resources. There is not yet a
commercially cleared replacement for the legacy frequency list; adding one is
part of the spoken-vocabulary milestone. Do not interpret Apache metadata as
clearance for the default data configuration.

[scripts/resources.json](scripts/resources.json) pins source revisions and SHA-256
checksums for both data and notices. `npm run assets` prepares them on first use;
subsequent runs verify/reuse local outputs without a network request. A source or
license change invalidates the corresponding acknowledgment. This is a local
record of the user's choice, not a new license or legal determination.

Local paths (ignored by Git):

- `.cache/resources/`: verified originals, upstream license texts and local
  personal-use acknowledgment. `legacy/` preserves pre-installer dictionary files.
- `public/dict/`: generated browser tables, upstream notices and `resources.json`
  containing provenance/checksums. Do not commit these generated derivatives either.
- `datasets/`, `models/`, `recordings/`: reserved for optional local assets.

Existing commits before this change contain the old dictionary tables. Untracking
files does not remove them from Git history; no history rewrite is performed.

## Speech models already downloaded on demand

These weights are not committed. The backend uses the Hugging Face cache; the
browser uses the Transformers.js/browser cache. They download when the respective
recognizer is first used, not all at startup. Cache eviction can cause another
download. The dictionary installer's checksum pins do not yet cover model weights.

| Checkpoint | License information observed at its upstream source |
| --- | --- |
| [facebook/wav2vec2-lv-60-espeak-cv-ft](https://huggingface.co/facebook/wav2vec2-lv-60-espeak-cv-ft) | Model card identifies Apache-2.0. |
| [onnx-community/wav2vec2-lv-60-espeak-cv-ft-ONNX](https://huggingface.co/onnx-community/wav2vec2-lv-60-espeak-cv-ft-ONNX) | Conversion's model card identifies Apache-2.0. |
| [openai/whisper-small.en](https://huggingface.co/openai/whisper-small.en) | This Hugging Face checkpoint card identifies Apache-2.0. Check the exact artifact, not only the original Whisper repository's license. |
| [onnx-community/whisper-base.en](https://huggingface.co/onnx-community/whisper-base.en) | Card links to the upstream Whisper checkpoint but did not expose a license tag during this review. Conversion-specific terms need confirmation before claiming commercial redistribution clearance. |

Model cards are provenance leads, not an exhaustive rights audit. Pin exact model
revisions and preserve applicable license files before publishing model bundles.

## Software dependencies and reference voices

`npm install` and `uv sync --directory backend` install dependencies locally under
their own licenses; lockfiles are not licenses. Source-only Apache licensing does
not mean a combined binary/bundle is Apache-only. In particular:

- `praat-parselmouth` 0.4.7 declares GPLv3/GPLv3+ in installed metadata. It is a
  currently unused backend dependency, not Apache-licensed project code. Review or
  remove it before treating a distributed backend bundle as permissively licensed.
- `edge-tts` 7.2.8 declares LGPLv3. Its client-library license is separate from
  Microsoft's online service terms and any rights in generated voice audio.
- NumPy, PyTorch, SoundFile and browser inference distributions can include native
  or bundled components with additional notices. Preserve installed licenses and
  audit the actual release artifacts, not just top-level package names.

System voices belong to their providers. Enabling online reference voices sends
reference text to an external service; it is not permission to redistribute its
voices or to sublicense generated recordings without checking the applicable terms.

## Benchmark corpora: opt-in, never bundled by default

The dictionary setup never downloads benchmark data. The separate, explicit
`npm run benchmark:prepare` command installs a speechocean762 selection in ignored
`datasets/`, outside `public/` and production builds. It preserves attribution and
the original README, pins metadata checksums and verifies audio against the pinned
Git tree. See [the benchmark guide](docs/human-benchmarks.md) and
`scripts/speechocean.json`. Per-recording labels and generated results stay local.

- [speechocean762](https://www.openslr.org/101/): OpenSLR currently lists CC BY 4.0.
  The implemented adapter retains author credit, source/revision links, the license
  link and a description of its selection/format changes. This data is not Apache-2.0.
- [L2-ARCTIC](https://psi.engr.tamu.edu/l2-arctic-corpus/): CC BY-NC 4.0; provider
  registration and agreement are required. The installer must not submit these for
  a user or bypass them.
- [Buckeye](https://buckeyecorpus.osu.edu/): free for noncommercial use with provider
  registration. Keep outside the app and repository.
- [Santa Barbara](https://linguistics.ucsb.edu/research/santa-barbara-corpus-spoken-american-english):
  publisher lists CC BY-ND 3.0 US. Check restrictions before sharing edited excerpts.

For each future adapter, record intended use, provider/version, terms URL, hashes,
local paths and any required acknowledgment. Download only on explicit selection.
User speech needs separate consent before upload or inclusion in a shared benchmark.

## Before distributing a website, package or container

1. Review code, dependency, data, model and voice terms separately.
2. Inspect the actual artifact: Vite copies `public/dict/` into `dist/dict/`.
   **Ignored by Git does not mean excluded from a build.** Do not publish that
   personal-use data configuration as commercially cleared software.
3. Preserve upstream notices. Obtain permission or replace/exclude restricted data.
   Runtime downloads must not be used as a licensing workaround.
4. Do not publish local acknowledgments, private recordings, credentials or dataset
   caches. A user's local acknowledgment does not speak for downstream users.
