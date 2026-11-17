# Signing the Windows installer

The Release workflow signs the installer with [SignPath](https://signpath.io) once it is set up. Until then it builds an unsigned installer, as before. No key is ever stored in this repository: SignPath keeps the certificate, and GitHub keeps the access token.

## What the workflow does

1. Builds the installer, `LocalPDF.Setup.<version>.exe`.
2. Uploads it as the artifact `unsigned-installer` and sends a signing request to SignPath, then waits for the signed file.
3. Puts the signed installer in place and checks its signature with `Get-AuthenticodeSignature`. An invalid signature stops the release.
4. Installs it silently on the clean machine, then drafts the release. The release notes say whether it is signed.

Only the installer is signed, not `LocalPDF.exe` inside it: SignPath does not open NSIS installers. The warning about an unknown publisher comes from the installer, so this is the file that matters.

Starting the workflow by hand (Actions, Release, Run workflow) builds, signs and installs without making a release: a trial.

## Setting it up

1. Apply to the [SignPath Foundation](https://signpath.org) for free signing of open-source projects, and connect this GitHub repository to SignPath as its trusted build system.
2. In SignPath, create a project with an artifact configuration for a zip that holds one installer:

   ```xml
   <artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
     <zip-file>
       <pe-file path="LocalPDF.Setup.*.exe">
         <authenticode-sign />
       </pe-file>
     </zip-file>
   </artifact-configuration>
   ```

3. In GitHub, under Settings, Secrets and variables, Actions, add:

   | Kind | Name | Value |
   |---|---|---|
   | Secret | `SIGNPATH_API_TOKEN` | The API token of a SignPath CI user that may submit to the project |
   | Variable | `SIGNPATH_ORGANIZATION_ID` | The organization ID from SignPath |
   | Variable | `SIGNPATH_PROJECT_SLUG` | The project's slug, such as `LocalPDF` |
   | Variable | `SIGNPATH_SIGNING_POLICY_SLUG` | `release-signing`, or `test-signing` to try it first |
   | Variable | `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG` | The slug of the configuration above |

4. Start the workflow by hand once, then check its log for "Signed by:".

After the first signed release, remove the "More info, then Run anyway" instructions from the README files and the release notes.
