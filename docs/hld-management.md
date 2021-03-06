# HLD - High Level Definition

Initialize a Bedrock HLD (High Level Definition) repository and deploy pipelines
to materalize manifests.

Usage:

```
spk hld [command] [options]
```

Commands:

- [HLD - High Level Definition](#hld---high-level-definition)
  - [Requirements](#requirements)
  - [Commands](#commands)
    - [init](#init)
    - [install-manifest-pipeline](#install-manifest-pipeline)
    - [reconcile](#reconcile)

Global options:

```
  -v, --verbose        Enable verbose logging
  -h, --help           Usage information
```

## Requirements

There are a few base assumptions that `spk` makes, as this will affect the set
up of pipelines:

1. Both HLD and manifest repositories are within a single Azure DevOps project.
2. The access token being utilized via `spk` has access to both repositories.
   - [Documentation on how to create a Personal Access Token](https://docs.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate?view=azure-devops)

Configure SPK using the configuration provided in your `.spk-config` file. The
configuration section under `azure_devops` _must_ be provided for SPK to
properly configure pipelines in your Azure DevOps organization.

An example configuration is as follows:

```
azure_devops:
  access_token: "hpe3a9oiswgcodtfdpzfiek3saxbrh5if1fp673xihgc5ap467a" # This is your Personal Access Token with permission to modify and access this private repo. Leave this empty if project is public
  hld_repository: "https://dev.azure.com/bhnook/fabrikam/_git/hld" # Repository URL for your Bedrock HLDs
  manifest_repository: "https://dev.azure.com/bhnook/fabrikam/_git/materialized" # Repository URL that is configured for flux. This holds the kubernetes manifests that is generated by fabrikate.
  org: "epicstuff" # Your AzDo Org
  project: "fabrikam" # Your AzDo project
```

## Commands

### init

Initialize the HLD repository by creating an `manifest-generation.yaml` file, if
one does not already exist.

```
Usage: spk hld init|i [options]

Initialize your hld repository. Will add the manifest-generation.yaml file to your working directory/repository if it does not already exist.

Options:
  --git-push  SPK CLI will try to commit and push these changes to a new origin/branch. (default: false)
  -h, --help  output usage information

```

### install-manifest-pipeline

After merging the azure-pipelines yaml file generated by the init step above
into the `master` branch, run the following command to install the HLD to
Manifest pipeline. This pipeline will be triggered on commits to master and
invoke "manifest generation"
[(via fabrikate)](https://github.com/microsoft/fabrikate), rendering helm charts
and configuration into Kubernetes yaml.

```
Usage: hld install-manifest-pipeline|p [options]

Install the manifest generation pipeline to your Azure DevOps instance. Default values are set in spk-config.yaml and can be loaded via spk init or overriden via option flags.

Options:
  -n, --pipeline-name <pipeline-name>                  Name of the pipeline to be created
  -p, --personal-access-token <personal-access-token>  Personal Access Token
  -o, --org-name <org-name>                            Organization Name for Azure DevOps
  -r, --hld-name <hld-name>                            HLD Repository Name in Azure DevOps
  -u, --hld-url <hld-url>                              HLD Repository URL
  -m, --manifest-url <manifest-url>                    Manifest Repository URL
  -d, --devops-project <devops-project>                Azure DevOps Project
  -b, --build-script <build-script-url>                Build Script URL. By default it is 'https://raw.githubusercontent.com/Microsoft/bedrock/master/gitops/azure-devops/build.sh'.
  -h, --help                                           output usage information
```

### reconcile

The reconcile feature scaffolds a HLD with the services in the `bedrock.yaml`
file at the root level of the application repository. Recall that in a
mono-repo, `spk service create` will add an entry into the `bedrock.yaml`
corresponding to all tracked services. When the service has been merged into
`master` of the application repository, a pipeline (see `hld-lifecycle.yaml`,
created by `spk project init`) runs `spk hld reconcile` to add any _new_
services tracked in `bedrock.yaml` to the HLD.

This command is _intended_ to be run in a pipeline (see the generated
`hld-lifecycle.yaml` created from `spk project init`), but can be run by the
user in a CLI for verification.

```
Usage: hld reconcile|r [options] <repository-name> <hld-path> <bedrock-application-repo-path>

Reconcile a HLD with the services tracked in bedrock.yaml.

Options:
  -h, --help  output usage information
```

For a `bedrock.yaml` file that resembles the following:

```
rings:
  ring-name:
    isDefault: true
services:
  ./packages/service-name:
    helm:
      chart:
        branch: 'master'
        git: 'github.com/contoso/helm-charts'
        path: 'service-name-chart'
```

A HLD is produced that resembles the following:

```
├── component.yaml
├── application-repo
│   ├── component.yaml
│   ├── config
│   └── service-name
│       ├── component.yaml
│       ├── config
│       └── ring-name
│           ├── component.yaml
│           ├── config
│           └── static
│               └── ingress-route.yaml
```
