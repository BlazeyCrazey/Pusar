# Releasing Pusar

Releases come from GitHub. Pushing a version tag runs [the release workflow](../.github/workflows/release.yml), which builds the installer, signs it once signing is set up, and creates a **draft** release. Nothing reaches anyone until you publish that draft. Installed copies of Pusar then find the update on their own.

## One-time setup

1. **Repository.** The project lives at [BlazeyCrazey/Pusar](https://github.com/BlazeyCrazey/Pusar). The release workflow points the update feed at whichever repository runs it.
2. **License.** All rights reserved (see [LICENSE](../LICENSE)). Before the first release, make sure the installer carries the licenses of the open-source parts, such as the bundled fonts.
3. **Code signing** (strongly recommended). Unsigned installers make Windows SmartScreen warn "Unknown publisher", and many people stop there.
   - Create a [Microsoft Trusted Signing](https://learn.microsoft.com/azure/trusted-signing/) account (about $10 a month) and pass its identity validation.
   - Create a certificate profile, and an app registration that's allowed to sign with it.
   - In the GitHub repository, under **Settings → Secrets and variables → Actions**, add:

     | Kind | Name | Value |
     |---|---|---|
     | Secret | `AZURE_TENANT_ID` | Your Azure tenant ID |
     | Secret | `AZURE_CLIENT_ID` | The app registration's client ID |
     | Secret | `AZURE_CLIENT_SECRET` | The app registration's secret |
     | Variable | `AZURE_SIGNING_ENDPOINT` | Such as `https://eus.codesigning.azure.net` |
     | Variable | `AZURE_SIGNING_ACCOUNT` | The Trusted Signing account name |
     | Variable | `AZURE_CERTIFICATE_PROFILE` | The certificate profile name |
     | Variable | `AZURE_PUBLISHER_NAME` | The name on the certificate, exactly |

   Until `AZURE_SIGNING_ACCOUNT` is set, the workflow still builds, but unsigned and with a warning.

## Each release

1. Set the version in `package.json`: `0.2.0` for a normal release, `0.2.0-beta.1` for a beta.
2. Make sure `npm run check` passes, and commit.
3. Tag and push: `git tag v0.2.0 && git push origin v0.2.0`. The tag must match the version, or the workflow stops.
4. When the workflow finishes, open the draft under **Releases**, write the notes, and publish it.
   - For a **beta**, tick **Set as a pre-release**. Only people who turned on **Get beta updates** in Settings get it.
5. Installed copies check a few seconds after starting and then every 6 hours. They download in the background and install the next time Pusar closes, or when someone presses **Restart to update**.

Every release carries update files for every channel, so someone on a beta moves to the next stable version when it's newer.

## Builds from your own machine

`npm run package:dir` builds a folder that never updates itself, and Settings says so. `npm run package` builds an installer, and electron-builder points it at this repository's releases because of the `repository` field in package.json, so copies installed from it update to the next published release.

## Before the first public release

- Run the live checks in [M0-SPIKES.md](M0-SPIKES.md) on a clean Windows 10 and Windows 11 machine.
- Publish a beta first, and update to it from the previous version, to prove the update path works before anyone relies on it.
