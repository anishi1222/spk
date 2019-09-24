import commander from "commander";
import fs from "fs";
import yaml from "js-yaml";
import path from "path";
import shelljs from "shelljs";
import { promisify } from "util";
import { exec } from "../../lib/shell";
import { logger } from "../../logger";
import {
  IAzurePipelinesYaml,
  IBedrockFile,
  IMaintainersFile
} from "../../types";

/**
 * Adds the init command to the commander command object
 *
 * @param command Commander command object to decorate
 */
export const initCommandDecorator = (command: commander.Command): void => {
  command
    .command("init")
    .alias("i")
    .description(
      "Initialize your spk repository. Will add starter bedrock, maintainers, and azure-pipelines YAML files to your project."
    )
    .option(
      "-m, --mono-repo",
      "Initialize this repository as a mono-repo. All directories under `packages` (modifiable with `-d` flag) will be initialized as packages.",
      false
    )
    .option(
      "-d, --packages-dir <dir>",
      "The directory containing the mono-repo packages. This is a noop if `-m` not set.",
      "packages"
    )
    .action(async opts => {
      const { monoRepo = false, packagesDir = "packages" } = opts;
      const projectPath = process.cwd();
      try {
        // Type check all parsed command line args here.
        if (typeof monoRepo !== "boolean") {
          throw new Error(
            `monoRepo must be of type boolean, ${typeof monoRepo} given.`
          );
        }
        if (typeof packagesDir !== "string") {
          throw new Error(
            `packagesDir must be of type 'string', ${typeof packagesDir} given.`
          );
        }
        await initialize(projectPath, { monoRepo, packagesDir });
      } catch (err) {
        logger.error(
          `Error occurred while initializing project ${projectPath}`
        );
        logger.error(err);
      }
    });
};

/**
 * Initializes the `rootProject` with a bedrock.yaml, maintainers.yaml, and azure-pipelines.yaml file
 * If opts.monoRepo == true, the root directly will be initialized as a mono-repo
 * If opts.monoRepo == true, all direct subdirectories under opts.packagesDir will be initialized as individual projects
 *
 * @param rootProjectPath Project root directory which will get initialized
 * @param opts Extra options to pass to initialize
 */
export const initialize = async (
  rootProjectPath: string,
  opts?: { monoRepo: boolean; packagesDir?: string }
) => {
  const { monoRepo = false, packagesDir = "packages" } = opts || {};
  const absProjectRoot = path.resolve(rootProjectPath);
  logger.info(
    `Initializing project ${absProjectRoot} as a ${
      monoRepo ? "mono-repository" : "standard service repository"
    }`
  );

  // Get a list of the target paths to initialize
  let absPackagePaths = [absProjectRoot];
  if (monoRepo) {
    const absPackagesDir = path.join(absProjectRoot, packagesDir);
    const filesAndFolders = await ls(absPackagesDir);
    absPackagePaths = filesAndFolders
      .map(fileOrFolder =>
        path.resolve(path.join(absPackagesDir, fileOrFolder))
      )
      .filter(f => fs.statSync(f).isDirectory());
  }

  // Initialize all paths
  await generateBedrockFile(absProjectRoot, absPackagePaths);
  await generateMaintainersFile(absProjectRoot, absPackagePaths);
  for (const absPackagePath of absPackagePaths) {
    await generateAzurePipelinesYaml(absProjectRoot, absPackagePath);
  }

  logger.info(`Project initialization complete!`);
};

/**
 * Helper function for listing files/dirs in a path
 *
 * @param dir path-like string; what you would pass to ls in bash
 */
const ls = async (dir: string): Promise<string[]> => {
  const lsRet = shelljs.ls(dir);
  if (lsRet.code !== 0) {
    logger.error(lsRet.stderr);
    throw new Error(
      `Error listing files in ${dir}; Ensure this directory exists or specify a different one with the --packages-dir option.`
    );
  }

  // Returned object includes piping functions as well; strings represent the actual output of the function
  const filesAndDirectories = lsRet.filter(out => typeof out === "string");

  return filesAndDirectories;
};

/**
 * Writes out a default maintainers.yaml file
 *
 * @param projectPath Path to generate the maintainers.yaml file
 */
const generateMaintainersFile = async (
  projectPath: string,
  packagePaths: string[]
) => {
  const absProjectPath = path.resolve(projectPath);
  const absPackagePaths = packagePaths.map(p => path.resolve(p));
  logger.info(`Generating maintainers.yaml file in ${absProjectPath}`);

  // Get default name/email from git host
  const [gitName, gitEmail] = await Promise.all(
    ["name", "email"].map(async field => {
      try {
        const gitField = await exec("git", ["config", `user.${field}`]);
        return gitField;
      } catch (_) {
        logger.warn(
          `Unable to parse git.${field} from host. Leaving blank value in maintainers.yaml file`
        );
        return "";
      }
    })
  );

  // Populate maintainers file
  const maintainersFile: IMaintainersFile = absPackagePaths.reduce<
    IMaintainersFile
  >(
    (file, absPackagePath) => {
      const relPathToPackageFromRoot = path.relative(
        absProjectPath,
        absPackagePath
      );
      // Root should use the value from reduce init
      if (relPathToPackageFromRoot !== "") {
        file.services["./" + relPathToPackageFromRoot] = {
          maintainers: [{ email: "", name: "" }]
        };
      }

      return file;
    },
    {
      services: {
        // initialize with the root containing the credentials of the caller
        "./": {
          maintainers: [
            {
              email: gitEmail,
              name: gitName
            }
          ]
        }
      }
    }
  );

  // Check if a maintainer.yaml already exists; skip write if present
  const maintainersFilePath = path.join(absProjectPath, "maintainers.yaml");
  logger.debug(`Writing maintainers.yaml file to ${maintainersFilePath}`);
  if (fs.existsSync(maintainersFilePath)) {
    logger.warn(
      `Existing maintainers.yaml found at ${maintainersFilePath}, skipping generation`
    );
  } else {
    // Write out
    await promisify(fs.writeFile)(
      maintainersFilePath,
      yaml.safeDump(maintainersFile),
      "utf8"
    );
  }
};

/**
 * Writes out a default bedrock.yaml
 *
 * @param targetPath Path to generate the the bedrock.yaml file in
 */
const generateBedrockFile = async (
  projectPath: string,
  packagePaths: string[]
) => {
  const absProjectPath = path.resolve(projectPath);
  const absPackagePaths = packagePaths.map(p => path.resolve(p));
  logger.info(`Generating bedrock.yaml file in ${absProjectPath}`);

  // Populate bedrock file
  const bedrockFile: IBedrockFile = absPackagePaths.reduce<IBedrockFile>(
    (file, absPackagePath) => {
      const relPathToPackageFromRoot = path.relative(
        absProjectPath,
        absPackagePath
      );
      file.services["./" + relPathToPackageFromRoot] = {
        helm: { chart: { git: "", branch: "", path: "" } }
      };
      return file;
    },
    { services: {} }
  );

  // Check if a bedrock.yaml already exists; skip write if present
  const bedrockFilePath = path.join(absProjectPath, "bedrock.yaml");
  logger.debug(`Writing bedrock.yaml file to ${bedrockFilePath}`);
  if (fs.existsSync(bedrockFilePath)) {
    logger.warn(
      `Existing bedrock.yaml found at ${bedrockFilePath}, skipping generation`
    );
  } else {
    // Write out
    await promisify(fs.writeFile)(
      bedrockFilePath,
      yaml.safeDump(bedrockFile),
      "utf8"
    );
  }
};

/**
 * Writes out the starter azure-pipelines.yaml file to `targetPath`
 *
 * @param targetPath Path to write the azure-pipelines.yaml file to
 */
const generateAzurePipelinesYaml = async (
  projectRoot: string,
  packagePath: string
) => {
  const absProjectRoot = path.resolve(projectRoot);
  const absPackagePath = path.resolve(packagePath);

  logger.info(`Generating starter azure-pipelines.yaml in ${absPackagePath}`);

  // Check if azure-pipelines.yaml already exists; if it does, skip generation
  const azurePipelinesYamlPath = path.join(
    absPackagePath,
    "azure-pipelines.yaml"
  );
  logger.debug(
    `Writing azure-pipelines.yaml file to ${azurePipelinesYamlPath}`
  );
  if (fs.existsSync(azurePipelinesYamlPath)) {
    logger.warn(
      `Existing azure-pipelines.yaml found at ${azurePipelinesYamlPath}, skipping generation`
    );
  } else {
    const starterYaml = await starterAzurePipelines({
      relProjectPaths: [path.relative(absProjectRoot, absPackagePath)]
    });
    // Write
    await promisify(fs.writeFile)(azurePipelinesYamlPath, starterYaml, "utf8");
  }
};

/**
 * Returns a starter azure-pipelines.yaml string
 * Starter azure-pipelines.yaml based on: https://github.com/andrebriggs/monorepo-example/blob/master/service-A/azure-pipelines.yml
 *
 * @param opts Template options to pass to the the starter yaml
 */
const starterAzurePipelines = async (opts: {
  relProjectPaths?: string[];
  vmImage?: string;
  branches?: string[];
  varGroups?: string[];
}) => {
  const {
    relProjectPaths = ["."],
    vmImage = "ubuntu-latest",
    branches = ["master"],
    varGroups = []
  } = opts;

  // Helper to concat list of script commands to a multi line string
  const generateYamlScript = (lines: string[]): string => lines.join("\n");

  // Ensure any blank paths are turned into "./"
  const cleanedPaths = relProjectPaths
    .map(p => (p === "" ? "./" : p))
    .map(p => (p.startsWith("./") === false ? "./" + p : p));

  // based on https://github.com/andrebriggs/monorepo-example/blob/master/service-A/azure-pipelines.yml
  const starter: IAzurePipelinesYaml = {
    trigger: {
      branches: { include: branches },
      paths: { include: cleanedPaths }
    },
    variables: {
      group: varGroups
    },
    pool: {
      vmImage
    },
    steps: [
      {
        displayName: "Run a multi-line script",
        script: generateYamlScript([
          `printenv | sort`,
          `pwd`,
          `ls -la`,
          `echo "The name of this service is: $(BUILD.BUILDNUMBER)"`
        ])
      },
      {
        displayName: "Azure Login",
        script: generateYamlScript([
          `echo "az login --service-principal --username $(SP_APP_ID) --password $(SP_PASS) --tenant $(SP_TENANT)"`,
          `az login --service-principal --username "$(SP_APP_ID)" --password "$(SP_PASS)" --tenant "$(SP_TENANT)"`
        ])
      },
      ...cleanedPaths.map(projectPath => {
        return {
          displayName: "ACR Build and Publish",
          script: generateYamlScript([
            `cd ${projectPath} # Need to make sure Build.DefinitionName matches directory. It's case sensitive`,
            `echo "az acr build -r $(ACR_NAME) --image $(Build.DefinitionName):$(build.SourceBranchName)-$(build.BuildId) ."`,
            `az acr build -r $(ACR_NAME) --image $(Build.DefinitionName):$(build.SourceBranchName)-$(build.BuildId) .`
          ])
        };
      }),
      {
        displayName: "Run a one-line script",
        script: generateYamlScript([`echo Hello, world!`])
      }
    ]
  };

  return yaml.safeDump(starter, { lineWidth: Number.MAX_SAFE_INTEGER });
};