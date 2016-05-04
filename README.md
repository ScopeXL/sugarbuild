## Synopsis

A nodejs application that automates the build process of SugarCRM. This project is targeted for developers
who rely on building instances of SugarCRM regularly. With options to install demo data through the PHP install
script or through SQL dumps that it can generate (or use another location for SQL dumps). It is built to be
modular, allowing you to control the entire installation process on what you want to do.

## Code Example
```
sugarbuild --runComposer=true --buildSugar=true --buildSidecar=true --installSugar=true --installDemoData=false
```
Check out the (Paramters)[https://github.com/ScopeXL/sugarbuild#parameters] section for a list of all the configurable options. All parameters can be set from the command line and/or the `config.json` file.

## Installation

This project is built using a number of tools. Here are the pre-requisites you should have installed (and available via the command line) before you run the application:
- git
- composer
- php
- mysql

Everything else is maintained by the npm install process.
Install the application:

Rename `config.sample.json` to `config.json`
Edit the `config.json` file to fit your installation needs. Don't forget to insert your SugarCRM license key:
```
{
  "sugarcrmLicense": "{YOUR_LICENSE_KEY}",
}
```
Clone the repo and install the application
```
git clone https://github.com/ScopeXL/sugarbuild.git
cd sugarbuild
npm install
```
Run the application with:
```
sugarbuild
```

## Parameters

All parameters are **optional**. You may also set them in the `config.json` file. Any/all parameters will proceed the `sugarbuild` command.

| Parameter | Example Value | Description |
| --- | --- | --- |
| --flavor | ent | The flavor of SugarCRM you are building |
| --version | 7.9.0.0 | The version of SugarCRM you are building |
| --sourceDir | /Users/me/sugar | The full path to your sugar git repo |
| --outputDir | /Users/me/Sites | The full path where the `sourceDir` is copied |
| --sqlDumpDir | /Users/me/Sites/sql | The full path where the created SQL dumps will be stored. Only needed if you plan on creating or importing a SQL dump |
| --baseWebUrl | http://localhost | The URL where you access SugarCRM after installation |
| --runComposer | true | Run `composer install` during the build process |
| --buildSugar | true | Copy the /sugarcrm directory from `sourceDir` to `outputDir` |
| --buildSidecar | true | Install sidecar during the build process |
| --installSugar | true | Run the PHP installation of SugarCRM in the background |
| --installDemoData | false | Install demo data from the PHP installation process. This can be very time consuming |
| --importDemoData | true | Import demo data from a SQL dump. This will only run if `installDemoData` is set to false | 
| --importDumpFile | master OR http://localhost:3000/data/master | If `importDemoData` is true, you **must** specify the location of the SQL dump using a filename in your `sqlDumpDir` or a URL to the file. Exclude **.sql** from either option you choose |
| --watchChanges | true | Similar to build-monitor. Once built it will continue listening for file changes in `sourceDir` and copy them to `outputDir` as they happen |
| --includeLanguage | false | Build with language string |
| --developerMode | true | Sets the developer mode during installation |
| --createSqlDump | false | Creates a SQL dump file in your `sqlDumpDir` once installation is complete |
| --enableBuildSchedule | false | Uses `git` to switch to each branch in the `"branches": []` array in the `config.json` file. It will then build each branch of sugar. Right now it will build each instance every 3 hours. This is best used when coupled with `createSqlDump` to provide multiple up-to-date SQL dumps for future builds |
| --enableWebServer | false | Starts a web server to allow others to `importDumpFile` from your SQL dump collection |
| --webServerPort | 3000 | The port that the web server listens on |


## Contributors

Contact @ScopeXL if you're interested in contributing to the project! Or simply submit your own pull request.

## License

This project is licensed under MIT.
