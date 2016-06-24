var Q = require('q'),
    fs = require('fs.extra'),
    _ = require('underscore'),
    moment = require('moment'),
    path = require('path'),
    exec = require('child_process').exec,
    childProcess = require('child_process'),
    phantomjs = require('phantomjs-prebuilt'),
    http = require('http'),
    https = require('https'),
    binPath = phantomjs.path,
    phantomHelper = require('./phantom-install-helper'),
    config = require('../config.json'),
    packageJson = require('../package.json'),
    startTime = new moment(),
    rerunCount = 0;

const chalk = require('chalk');

// extra config settings
config.sugarDir = path.join(config.sourceDir, 'sugarcrm');

module.exports = {
    // get config variable
    getConfig: function(key) {
        return config[key];
    },
    // set a config variable
    setConfig: function(key, val) {
        config[key] = val;
    },
    // list the config variables in the console
    listConfig: function() {
        this.log('----------', 'magenta');
        this.log('Build Flavor:', 'cyan', this.getConfig('flavor'), 'magenta');
        this.log('Build Version:', 'cyan', this.getConfig('version'), 'magenta');
        this.log('Build SugarCRM:', 'cyan', this.getConfig('buildSugar'), 'magenta');
        this.log('Build Sidecar:', 'cyan', this.getConfig('buildSidecar'), 'magenta');
        this.log('Install SugarCRM:', 'cyan', this.getConfig('installSugar'), 'magenta');
        this.log('Install Demo Data:', 'cyan', this.getConfig('installDemoData'), 'magenta');
        this.log('Import Demo Data:', 'cyan', this.getConfig('importDemoData'), 'magenta');
        if (!_.isEmpty(this.getConfig('importDumpFile'))) {
            this.log('Import SQL File:', 'cyan', this.getConfig('importDumpFile'), 'magenta');
        }
        this.log('Include Language:', 'cyan', this.getConfig('includeLanguage'), 'magenta');
        this.log('Watch for Changes:', 'cyan', this.getConfig('watchChanges'), 'magenta');
        this.log('----------', 'magenta');

        if (this.getConfig('enableWebServer')) {
            this.log('Web Server Listening on:', 'gray',
                'http://localhost:' + this.getConfig('webServerPort'), 'magenta'
            );
        }
    },
    // check command line arguments and overwrite config based on values
    checkCommandLineArgs: function() {
        for (var key in config) {
            // check if this config variable exists in the arguments
            process.argv.forEach(function(val, index, array) {
                if (val.substring(0, key.length + 3) === '--' + key + '=') {
                    var configValue = val.substring(key.length + 3);
                    // store the new config value
                    if (_.isEqual(configValue, 'true') || _.isEqual(configValue, 'false')) {
                        // store a proper boolean value
                        config[key] = _.isEqual(configValue, 'true') ? true : false;
                    } else {
                        config[key] = configValue;
                    }
                }
            });
        }
    },
    // Log a console message using the chalk package
    // Usage: log('My message!', 'yellow', 'My second message!', 'green')
    log: function() {
        var args = (arguments.length === 1 ? [arguments[0]] : Array.apply(null, arguments)),
            logMsg = '',
            timestamp = moment().format('HH:mm:ss');

        if (args.length % 2 === 0) {
            for (var i = 0; i < args.length; i++) {
                if (i % 2 === 0) {
                    var message = args[i];
                    var color = args[i + 1];

                    logMsg += chalk[color](message) + ' ';
                }
            }

            console.log(
                chalk.gray(
                    '[' + timestamp + ']' +
                    (!_.isEmpty(this.getConfig('currentBranch')) ? ' ' + this.getConfig('currentBranch') : '')
                ) + ' ' +
                logMsg
            );
        } else {
            log('Error: logging must take parameters divisible by 2', 'red');
        }
    },
    // listen for changes to files inside the sugarcrm directory and copy to the output directory
    watchChanges: function() {
        var deferred = Q.defer(),
            $this = this;

        if (!this.getConfig('watchChanges')) {
            deferred.resolve();
        } else {
            this.log('Watching', 'cyan', this.getConfig('sugarDir'), 'magenta', 'for changes', 'cyan');
            fs.watch(this.getConfig('sugarDir'), {recursive: true}, function(ev, filename) {
                var outputFilePath = path.join($this.getConfig('outputDir'), $this.getConfig('flavor'), filename),
                    sourceFilePath = path.join($this.getConfig('sugarDir'), filename);

                // get file stats
                fs.lstat(sourceFilePath, function(err, stats) {
                    if (err) {
                        if (_.isEqual(err.code, 'ENOENT')) {
                            // file no longer exists, remove from output
                            // check if the file/folder exists in the output directory
                            fs.lstat(outputFilePath, function(err, outputStats) {
                                // file/folder exists, remove it
                                if (err) {
                                    deferred.reject(err);
                                    return deferred.promise;
                                }

                                if (outputStats.isFile()) {
                                    // remove file
                                    fs.unlink(outputFilePath, function(err) {
                                        if (err) {
                                            deferred.reject(err);
                                            return deferred.promise;
                                        }
                                        $this.log('✔ ' + filename, 'gray');
                                        deferred.resolve();
                                    });
                                } else if (outputStats.isDirectory()) {
                                    // remove directory
                                    fs.rmrf(outputFilePath, function(err) {
                                        if (err) {
                                            deferred.reject(err);
                                            return deferred.promise;
                                        }
                                        $this.log('✔ ' + filename, 'gray');
                                        deferred.resolve();
                                    });
                                }
                            });
                        } else {
                            deferred.reject(err);
                            return deferred.promise;
                        }
                    }

                    if (!_.isUndefined(stats)) {
                        // stats found, check if file/folder and perform operations
                        if (stats.isFile()) {
                            // copy file to output directory
                            Q.when($this.copyFile(filename)).then(function() {
                                // Perform extra tasks based on the file extension
                                var ext = path.extname(filename);

                                switch (ext) {
                                    // Remove the cache directory css file so sugar rebuilds the css
                                    case '.less':
                                        var cssDir = path.join(
                                            $this.getConfig('outputDir'),
                                            $this.getConfig('flavor'),
                                            'cache',
                                            'themes',
                                            'clients',
                                            'base',
                                            'default'
                                        );

                                        fs.rmrf(cssDir, function(err) {
                                            if (err) {
                                                $this.log(err, 'red');
                                            } else {
                                                $this.log('Built CSS styles', 'cyan');
                                            }
                                        });
                                        break;
                                }

                                $this.log('✔ ' + filename, 'green');

                            }, function(err) {
                                console.log(err);
                                deferred.reject(err);
                                return deferred.promise;
                            });
                        } else if (stats.isDirectory()) {
                            // create directory in output directory
                            fs.mkdirpSync(outputFilePath);
                            $this.log('✔ ' + filename, 'green');
                        }
                    }
                });
            });
            deferred.resolve();
        }

        return deferred.promise;
    },
    // copy a file to the output directory
    copyFile: function(filename) {
        var deferred = Q.defer(),
            $this = this;

        fs.copy(
            path.join(this.getConfig('sugarDir'), filename),
            path.join(this.getConfig('outputDir'), this.getConfig('flavor'), filename),
            {
                replace: true
            },
            function(err) {
                if (err) {
                    deferred.reject(err);
                }

                deferred.resolve();
            }
        );

        return deferred.promise;
    },
    // run composer operations
    runComposer: function() {
        var deferred = Q.defer(),
            $this = this,
            cmd = 'cd ' + this.getConfig('sugarDir') + ';' +
                'composer install';

        if (!this.getConfig('runComposer')) {
            deferred.resolve();
        } else {
            this.log('Running composer install...', 'yellow');
            Q.when(this.runCommand(cmd)).then(function(stdout, stderr) {
                $this.log('Composer installation complete', 'green');
                deferred.resolve();
            });
        }

        return deferred.promise;
    },
    // clean the output path before the build copies to the output directory
    cleanOutputPath: function() {
        var deferred = Q.defer(),
            $this = this,
            cmd = 'rm -rf ' +
                path.join(this.getConfig('outputDir'), this.getConfig('flavor'), '*');

        // do not allow output path to be empty
        if (_.isEmpty(this.getConfig('outputDir'))) {
            this.log('Output directory cannot be empty', 'red');
            deferred.reject();
            return deferred.promise;
        }

        Q.when(this.runCommand(cmd)).then(function(stdout, stderr) {
            deferred.resolve();
        });

        return deferred.promise;
    },
    // build sugar to output directory
    sugar: function() {
        var deferred = Q.defer(),
            $this = this,
            cmd = '';

        if (!this.getConfig('buildSugar')) {
            deferred.resolve();
        } else {
            Q.when(this.cleanOutputPath()).then(function() {
                $this.log('Building SugarCRM to', 'yellow', $this.getConfig('outputDir'), 'magenta');
                var argsString =
                    '--ver=' + $this.getConfig('version') + ' ' +
                    '--flav=' + $this.getConfig('flavor') + ' ' +
                    '--base_dir=' + $this.getConfig('sugarDir') + ' ' +
                    '--build_dir=' + $this.getConfig('outputDir') + ' ' +
                    '--clean=0' + ' ' +
                    ($this.getConfig('includeLanguage') ? ' --latin' : '');

                cmd = 'cd ' + path.join($this.getConfig('sourceDir'), 'build', 'rome') + ';' +
                    'php build.php ' + argsString;

                Q.when($this.runCommand(cmd)).then(function(stdout, stderr) {
                    if (stdout.indexOf('DONE') >= 0) {
                        $this.log('Build complete', 'green');
                        deferred.resolve();
                    } else {
                        $this.log(stdout, 'red');
                        deferred.reject();
                    }
                });
            }, function(err) {
                deferred.reject(err);
            });
        }

        return deferred.promise;
    },
    // build sidecar in output directory
    sidecar: function() {
        var deferred = Q.defer(),
            $this = this,
            cmd = 'cd ' + path.join(this.getConfig('outputDir'), this.getConfig('flavor'), 'sidecar') + ';' +
                'npm install;' +
                // TODO: remove this once sidecar's package.json includes process
                'npm install process;' +
                'gulp';

        if (!this.getConfig('buildSidecar')) {
            deferred.resolve(true);
        } else {
            this.log('Building Sidecar...', 'yellow');

            Q.when(this.runCommand(cmd)).then(function(stdout, stderr) {
                if (stdout.indexOf('Finished \'default\'') >= 0) {
                    $this.log('Sidecar built', 'green');
                    deferred.resolve(true);
                } else {
                    $this.log(stdout, 'red');
                    deferred.reject();
                }
            }, function(err) {
                $this.log(err, 'red');
            });

            return deferred.promise;
        }
    },
    createDatabase: function() {
        var deferred = Q.defer(),
            cmd = 'mysql ' +
                '--host="' + config.sugar_config_si.setup_db_host_name + '" ' +
                '--user="' + config.sugar_config_si.setup_db_admin_user_name + '" ' +
                '--password="' + config.sugar_config_si.setup_db_admin_password + '" ' +
                '-e \'CREATE DATABASE IF NOT EXISTS `' + config.sugar_config_si.setup_db_database_name + '`\'';

        Q.when(this.runCommand(cmd)).then(function(stdout, stderr) {
            deferred.resolve();
        });

        return deferred.promise;
    },
    // install SugarCRM and create the SQL dump if necessary
    install: function() {
        var deferred = Q.defer(),
            $this = this,
            checkInterval,
            installData = '',
            cmd = '',
            installUrl = '';

        if (!this.getConfig('installSugar')) {
            deferred.resolve();
        } else {
            // run installation
            this.log('Installing SugarCRM' +
                (this.getConfig('installDemoData') ? ' with Demo Data' : '') + '...', 'yellow'
            );

            installUrl = this.getConfig('baseWebUrl') + '/' + this.getConfig('flavor') +
                '/install.php?goto=SilentInstall&cli=true';

            var childArgs = [
                path.join(__dirname, 'phantom-install.js'),
                installUrl
            ];

            var phantomInstall = childProcess.execFile(binPath, childArgs);
            phantomInstall.stdout.on('data', function(data) {
                installData = data;
                //$this.log(installData, 'gray');
                phantomHelper.checkItems(data, function(completeItem) {
                    $this.log('--', 'gray', completeItem, 'green');

                    if (_.isEqual(completeItem, 'Inserting demo data...')) {
                        checkInterval = setInterval(function() {
                            $this.log('---- working...', 'gray');
                        }, 10000);
                    }
                });
            });
            phantomInstall.stderr.on('data', function(data) {
                $this.log(data, 'red');
                deferred.reject(data);
            });
            phantomInstall.on('close', function(code) {
                var timestamp = new moment().format('YYYY-MM-DD-HH-mm-ss');
                clearInterval(checkInterval);
                installData = '',
                resolveOptions = {
                    branch: '',
                    sqlDumpCreated: false
                };

                if (!phantomHelper.checkComplete()) {
                    $this.log('Install process failed to complete.', 'red', 'Trying again...', 'yellow');
                    // the script failed completing the install, run it again
                    // cleanup phantom helper variables
                    phantomHelper.cleanup();
                    deferred.reject('rerun');
                    return deferred.promise;
                }

                $this.log('Installation Complete', 'green');

                if (!$this.getConfig('createSqlDump')) {
                    // do not create a dump file
                    deferred.resolve(resolveOptions);
                } else {
                    // get the current branch
                    Q.when($this.getCurrentBranch()).then(function(branchName) {
                        // set the branch name for the next method on callback
                        resolveOptions.branch = branchName;
                        cmd = 'mysqldump ' +
                            '--host="' + config.sugar_config_si.setup_db_host_name + '" ' +
                            '--user="' + config.sugar_config_si.setup_db_admin_user_name + '" ' +
                            '--password="' + config.sugar_config_si.setup_db_admin_password + '" ' +
                            '--add-drop-database --databases ' + config.sugar_config_si.setup_db_database_name +
                            ' > ' +
                            path.join(
                                $this.getConfig('sqlDumpDir'),
                                branchName + '_' + $this.getConfig('flavor') + '.sql'
                            );

                        $this.log('Creating SQL dump file', 'yellow');

                        // check if the dump directory exists
                        if (!$this.checkFileExists($this.getConfig('sqlDumpDir'))) {
                            // dump directory does not exist, create it
                            fs.mkdirpSync($this.getConfig('sqlDumpDir'));
                        }

                        Q.when($this.runCommand(cmd)).then(function(stdout, stderr) {
                            // cleanup phantom helper variables
                            phantomHelper.cleanup();

                            $this.log('SQL dump file created at', 'green',
                                path.join(
                                    $this.getConfig('sqlDumpDir'),
                                    branchName + '_' + $this.getConfig('flavor') + '.sql'
                                ), 'magenta'
                            );

                            // set options to show a SQL dump was created
                            resolveOptions.sqlDumpCreated = true;
                            deferred.resolve(resolveOptions);
                        });
                    }, function(err) {
                        deferred.reject(err);
                    });
                }
            });
        }

        return deferred.promise;
    },
    // convert SQL file to remove private information
    convertSqlPrivate: function(options) {
        var deferred = Q.defer(),
            $this = this,
            branchPath = path.join(this.getConfig('sqlDumpDir'),
                options.branch + '_' + this.getConfig('flavor') + '.sql'
            ),
            reRemoveLicenseKey = new RegExp(this.getConfig('sugarcrmLicense'), 'gm'),
            reRemoveDatabaseName = new RegExp(config.sugar_config_si.setup_db_database_name, 'gm');

        Q.when(this.readFile(branchPath)).then(function(data) {
            if (_.isEmpty(data)) {
                $this.log('Error opening the SQL dump file:', 'red', branchPath, 'magenta');
                deferred.reject();
                return deferred.promise;
            }

            // remove private info and insert placeholders
            $this.log('Removing private information from the SQL dump', 'yellow');
            // replace the license key with a placeholder
            if (!_.isNull(data.match(reRemoveLicenseKey)) && data.match(reRemoveLicenseKey).length > 0) {
                $this.log('-- Removed License Key', 'green');
                data = data.replace(reRemoveLicenseKey, '{{LICENSE_KEY}}');
            } else {
                $this.log('-- License Key was not found', 'red');
            }
            // replace the database name with a placeholder
            if (!_.isNull(data.match(reRemoveDatabaseName)) && data.match(reRemoveDatabaseName).length > 0) {
                $this.log('-- Removed Database Name', 'green');
                data = data.replace(reRemoveDatabaseName, '{{DB_NAME}}');
            } else {
                $this.log('-- Database name was not found', 'red');
            }

            // write the new SQL dump file
            fs.writeFile(branchPath, data, 'utf8', function(err) {
                if (err) {
                    deferred.reject();
                    return deferred.promise;
                }

                $this.log('SQL file updated successfully', 'green');
                deferred.resolve();
            });
        }, function(err) {
            deferred.reject(err);
        });

        return deferred.promise;
    },
    // convert SQL file to include private information (in a temporary file)
    convertSqlPublic: function(sqlDumpLocation) {
        var deferred = Q.defer(),
            $this = this,
            branchPath = sqlDumpLocation,
            reAddLicenseKey = new RegExp('\\{\\{LICENSE_KEY\\}\\}', 'gm'),
            reAddDatabaseName = new RegExp('\\{\\{DB_NAME\\}\\}', 'gm'),
            tmpDumpLocation = path.join(__dirname, 'tmp-import.sql');

        Q.when(this.readFile(branchPath)).then(function(data) {
            if (_.isEmpty(data)) {
                $this.log('Error opening the SQL dump file:', 'red', branchPath, 'magenta');
                deferred.reject();
                return deferred.promise;
            }

            // include private info, remove all placeholders and insert data
            $this.log('Inserting private information into the SQL dump...', 'yellow');
            // replace the license key placeholder with the config license key
            if (!_.isNull(data.match(reAddLicenseKey)) && data.match(reAddLicenseKey).length > 0) {
                $this.log('-- Inserted License Key', 'green');
                data = data.replace(reAddLicenseKey, $this.getConfig('sugarcrmLicense'));
            } else {
                $this.log('-- License Key was not found', 'red');
            }
            // replace the database name placeholder with the config database name
            if (!_.isNull(data.match(reAddDatabaseName)) && data.match(reAddDatabaseName).length > 0) {
                $this.log('-- Inserted Database Name', 'green');
                data = data.replace(reAddDatabaseName, config.sugar_config_si.setup_db_database_name);
            } else {
                $this.log('-- Database name was not found', 'red');
            }

            // write the new SQL dump file
            fs.writeFile(tmpDumpLocation, data, 'utf8', function(err) {
                if (err) {
                    deferred.reject();
                    return deferred.promise;
                }

                $this.log('SQL file updated successfully', 'green');
                deferred.resolve();
            });
        }, function(err) {
            deferred.reject(err);
        });

        return deferred.promise;
    },
    // get URL contents
    getUrl: function(url) {
        var deferred = Q.defer(),
            $this = this,
            data = '';

        if (_.isEqual(url.substring(0, 5), 'https')) {
            // URL is an SSL site
            https.get(url, function(res) {
                // merge the response data
                res.on('data', function(chunk) {
                    data += chunk;
                });

                // when we received all data
                res.on('end', function() {
                    deferred.resolve(data);
                });

            }).on('error', function(e) {
                $this.log('Error: ' + e.message, 'red');
                deferred.reject(e.message);
            });
        } else {
            // URL is non-SSL
            http.get(url, function(res) {
                // merge the response data
                res.on('data', function(chunk) {
                    data += chunk;
                });

                // when we received all data
                res.on('end', function() {
                    deferred.resolve(data);
                });

            }).on('error', function(e) {
                $this.log('Error: ' + e.message, 'red');
                deferred.reject(e.message);
            });
        }

        return deferred.promise;
    },
    // version check
    versionCheck: function() {
        var deferred = Q.defer(),
            $this = this,
            versionUrl = 'https://raw.githubusercontent.com/ScopeXL/sugarbuild/master/package.json';

        Q.when(this.getUrl(versionUrl)).then(function(data) {
            data = JSON.parse(data);

            if (_.isEqual(data.version, packageJson.version)) {
                deferred.resolve();
            } else {
                // version doesn't match up
                $this.log(
                    'A new version', 'yellow',
                    data.version, 'magenta',
                    'is available. Current version:', 'yellow',
                    packageJson.version, 'magenta'
                );
                $this.log('Download at:', 'cyan', 'https://github.com/ScopeXL/sugarbuild', 'magenta');
                deferred.reject();
            }
        }, function(err) {
            $this.log('Error retrieving version from server', 'red');
            $this.log(err);
            deferred.reject(err);
        });

        return deferred.promise;
    },
    // before we actually import data, figure out how it needs to be handled
    preImport: function() {
        var deferred = Q.defer(),
            $this = this,
            sqlDumpLocation = '',
            tmpDumpLocation = path.join(__dirname, 'tmp-import.sql');

        if (!_.isEmpty(this.getConfig('importDumpFile'))) {
            // we need to import a dump file locally
            // SQL dump file is a file name, copy it to a temp location
            sqlDumpLocation = path.join(this.getConfig('sqlDumpDir'), this.getConfig('importDumpFile')) + '.sql';
            deferred.resolve(sqlDumpLocation, tmpDumpLocation);
        } else if (!_.isEmpty(this.getConfig('importHost')) && !_.isEmpty(this.getConfig('importBranch'))) {
            // we need to grab a branch from a remote host and import it
            // SQL dump file is a URL
            sqlDumpLocation = this.getConfig('importHost') +
                '/data/' +
                this.getConfig('importBranch') + '_' + this.getConfig('flavor');

            this.log(
                'Importing branch', 'yellow',
                this.getConfig('importBranch'), 'magenta',
                'from', 'yellow',
                this.getConfig('importHost'), 'magenta'
            );

            Q.when(this.getUrl(sqlDumpLocation)).then(function(data) {
                if (_.isEqual(data.substring(0, 12), 'No data file')) {
                    $this.log('No import by that branch name exists', 'red');
                    deferred.reject();
                    return deferred.promise;
                }
                fs.writeFile(tmpDumpLocation, data, 'utf8', function(err) {
                    if (err) {
                        deferred.reject(err);
                    }

                    deferred.resolve(tmpDumpLocation, tmpDumpLocation);
                });
            }, function(err) {
                deferred.reject(err);
            });
        }

        return deferred.promise;
    },
    // import demo data from a SQL dump file
    import: function() {
        var deferred = Q.defer(),
            $this = this,
            tmpDumpLocation = path.join(__dirname, 'tmp-import.sql'),
            cmd = 'mysql ' +
                '--host="' + config.sugar_config_si.setup_db_host_name + '" ' +
                '--user="' + config.sugar_config_si.setup_db_admin_user_name + '" ' +
                '--password="' + config.sugar_config_si.setup_db_admin_password + '" ' +
                config.sugar_config_si.setup_db_database_name + ' < ' + tmpDumpLocation;

        // do we import an SQL dump file?
        if (this.getConfig('importDemoData') && !this.getConfig('installDemoData')) {
            // only import demo data if installDemoData is false
            this.log('Starting import procedure...', 'yellow');

            Q.when(this.preImport()).then(function(sqlDumpLocation) {
                // import procedure is complete, now import the data based on the sqlDumpLocation
                // convert the SQL dump to include config variables
                Q.when($this.convertSqlPublic(sqlDumpLocation)).then(function() {
                    $this.log('Importing demo data...', 'yellow');

                    Q.when($this.runCommand(cmd)).then(function(stdout, stderr) {
                        // Remove temporary import file if it exists
                        if ($this.checkFileExists(tmpDumpLocation)) {
                            // remove the file
                            fs.unlinkSync(tmpDumpLocation);
                        }

                        $this.log('Import complete', 'green');
                        deferred.resolve();
                    });
                });
            }, function(err) {
                deferred.reject(err);
            });
        } else {
            deferred.resolve();
        }

        return deferred.promise;
    },
    // create the config_si.php file
    createConfig: function() {
        var deferred = Q.defer(),
            configObj = this.getConfig('sugar_config_si'),
            phpStr = '',
            $this = this;

        this.log('Writing configuration file...', 'yellow');
        // convert the values that need it for the config_si.php file
        if (_.isEqual(configObj.setup_license_key, '{{auto_convert}}')) {
            configObj.setup_license_key = this.getConfig('sugarcrmLicense');
        }
        if (_.isEqual(configObj.developerMode, '{{auto_convert}}')) {
            configObj.developerMode = this.getConfig('developerMode') ? 1 : 0;
        }
        if (_.isEqual(configObj.setup_db_database_name, '{{auto_convert}}')) {
            if (this.getConfig('enableBuildSchedule')) {
                // running on a schedule, use a temp db name
                configObj.setup_db_database_name = 'sugar7' + this.getConfig('flavor') + '_build';
            } else {
                configObj.setup_db_database_name = 'sugar7' + this.getConfig('flavor');
            }
        }
        if (_.isEqual(configObj.demoData, '{{auto_convert}}')) {
            configObj.demoData = this.getConfig('installDemoData') ? 'yes' : 'no';
        }
        if (_.isEqual(configObj.setup_site_url, '{{auto_convert}}')) {
            configObj.setup_site_url = this.getConfig('baseWebUrl') + '/' + this.getConfig('flavor') + '/';
        }
        // build the sugar_config_si array file
        _.each(configObj, function(val, key) {
            if (_.isNumber(val) || _.isBoolean(val)) {
                // value is a number or boolean, treat it as such
                phpStr += '    ' + wrapQuotes(key) + ' => ' + val + ',\n';
            } else {
                // value is a string
                phpStr += '    ' + wrapQuotes(key) + ' => ' + wrapQuotes(val) + ',\n';
            }
        });

        fs.writeFile(path.join(this.getConfig('outputDir'), this.getConfig('flavor'), 'config_si.php'),
            '<?php\n$sugar_config_si = array(\n' + phpStr + ');', function(err) {
                if (err) {
                    deferred.reject(err);
                }

                deferred.resolve();
                $this.log('Configuration file saved', 'green');
            }
        );

        return deferred.promise;
    },
    switchBranch: function(branch) {
        var deferred = Q.defer(),
            cmd = 'cd ' + this.getConfig('sourceDir') + ';' +
                'git fetch;' +
                'git checkout ' + branch + ';' +
                'git pull;' +
                'git submodule update';

        Q.when(this.runCommand(cmd)).then(function(stdout, stderr) {
            deferred.resolve();
        });

        return deferred.promise;
    },
    // get the current branch from the source directory
    getCurrentBranch: function() {
        var deferred = Q.defer(),
            $this = this,
            cmd = 'cd ' + this.getConfig('sourceDir') + ';' +
                //'git rev-parse --abbrev-ref HEAD',
                'git branch 2> /dev/null | sed -e \'/^[^*]/d\' -e \'s/* \\(.*\\)/ (\\1)/\'';

        Q.when(this.runCommand(cmd)).then(function(stdout, stderr) {
            // (HEAD detached at upstream/master)
            if (stdout.indexOf('HEAD detached at') >= 0) {
                // need to strip away everything but the git branch
                stdout = stdout.replace('HEAD detached at', '');
            }

            // if branch has remote/branch
            if (stdout.indexOf('/') >= 0) {
                var info = stdout.split('/');
                // only include the branch name
                stdout = info[1];
            }

            // return the branch name stripping away parentheses and whitespace
            stdout = stdout.replace(/\s|\(|\)/g, '');
            deferred.resolve(stdout);
        });

        return deferred.promise;
    },
    // check if a file exists
    checkFileExists: function(filePath) {
        try {
            var dataFileStats = fs.statSync(filePath);
        } catch (err) {
            if (_.isEqual(err.code, 'ENOENT')) {
                // file does not exist at the location
                return false;
            }
        }

        return true;
    },
    // read a file and return the data
    readFile: function(filePath) {
        var deferred = Q.defer();

        fs.readFile(filePath, 'utf8', function(err, data) {
            if (err) {
                deferred.reject(err);
            } else {
                deferred.resolve(data);
            }
        });

        return deferred.promise;
    },
    // list of files from a directory
    fileList: function(filePath) {
        var deferred = Q.defer();

        fs.readdir(filePath, function(err, files) {
            if (err) {
                deferred.reject(err);
            } else {
                var tmpFiles = [],
                    currentTimestamp = moment();

                _.each(files, function(file) {
                    var fullFilePath = path.join(filePath, file),
                        branch = '',
                        flavor = '';

                    if (_.isEqual(file.substring(0, 1), '.')) {
                        // ignore files meant to be ignored
                        return;
                    }

                    // set the branch/flavor from the filename
                    // strip path and extenstion from filename
                    branch = path.basename(fullFilePath, '.sql');
                    branch = branch.substring(0, branch.length - 4);
                    flavor = path.basename(fullFilePath, '.sql');
                    flavor = flavor.substring(flavor.length - 3, flavor.length);

                    try {
                        var dataFileStats = fs.statSync(fullFilePath);
                        tmpFiles.push({
                            path: fullFilePath,
                            name: branch,
                            flavor: flavor,
                            filename: path.basename(fullFilePath, '.sql'),
                            // when was the file last modified
                            modified: moment(dataFileStats.mtime).from(currentTimestamp),
                            filesize: bytesToSize(dataFileStats.size)
                        });
                    } catch (err) {
                        deferred.reject(err);
                    }
                });

                deferred.resolve(tmpFiles);
            }
        });

        return deferred.promise;
    },
    // perform a full build
    full: function(callback) {
        // reset the start time
        startTime = new moment();

        /*if (this.getConfig('enableBuildSchedule')) {
            // running a build schedule, install all builds to a build directory
            this.setConfig('outputDir', path.join(this.getConfig('outputDir'), 'schedule'));
        }*/

        this.processStartBuild(callback);
    },
    // Build process helper functions
    processStartBuild: function(callback) {
        var $this = this;
        Q.when(this.runComposer()).then(function() {
            $this.processBuildSugar(callback);
        }, function(err) {
            throw err;
        });
    },
    processBuildSugar: function(callback) {
        var $this = this;
        Q.when(this.sugar()).then(function() {
            $this.processCreateConfig(callback);
        }, function(err) {
            throw err;
        });
    },
    processCreateConfig: function(callback) {
        var $this = this;
        Q.when(this.createConfig()).then(function() {
            $this.processBuildSidecar(callback);
        });
    },
    processBuildSidecar: function(callback) {
        var $this = this;
        Q.when(this.sidecar()).then(function() {
            $this.processCreateDatabase(callback);
        });
    },
    processCreateDatabase: function(callback) {
        var $this = this;
        Q.when(this.createDatabase()).then(function() {
            $this.processInstallSugar(callback);
        });
    },
    processInstallSugar: function(callback) {
        var $this = this;
        Q.when(this.install()).then(function(options) {
            if (!_.isUndefined(options) && options.sqlDumpCreated) {
                // SQL dump was created, convert it
                $this.processConvertSql(options, callback);
            } else {
                // No SQL dump was created, skip to demo data step
                $this.processImportDemoData(callback);
            }
        }, function(err) {
            if (_.isEqual(err, 'rerun')) {
                rerunCount++;
                $this.log('Rerun Attempt', 'cyan', rerunCount, 'magenta');
                // run installation again
                //$this.processInstallSugar(callback);
                // run the whole process again
                $this.processStartBuild(callback);
                /*if (rerunCount > 3) {
                    if (!_.isUndefined(options) && options.sqlDumpCreated) {
                        // SQL dump was created, convert it
                        $this.processConvertSql(options, callback);
                    } else {
                        // No SQL dump was created, skip to demo data step
                        $this.processImportDemoData(callback);
                    }

                    $this.log('Installation failed 3 times, continuing...', 'yellow');

                    // Reset rerun count
                    rerunCount = 0;
                } else {
                    // run installation again
                    $this.processInstallSugar(callback);
                }*/
            } else {
                throw err;
            }
        });
    },
    processConvertSql: function(options, callback) {
        var $this = this;
        Q.when(this.convertSqlPrivate(options)).then(function() {
            $this.processImportDemoData(callback);
        }, function(err) {
            throw err;
        });
    },
    processImportDemoData: function(callback) {
        var $this = this;
        Q.when(this.import()).then(function() {
            $this.processWatchChanges(callback);
        }, function(err) {
            throw err;
        });
    },
    processWatchChanges: function(callback) {
        var $this = this;
        Q.when(this.watchChanges()).then(function() {
            $this.finish(callback);

            if ($this.getConfig('watchChanges')) {
                // we are watching the sugarcrm directory for file changes
                $this.log('Listening for changes to the sugarcrm directory...', 'gray');
            }
        });
    },
    finish: function(callback) {
        var finishTime = new moment();
        var elapsedMs = finishTime.diff(startTime);
        var elapsedFormat = moment.duration(elapsedMs).asSeconds();
        this.log('----------', 'magenta');
        this.log('SugarCRM is Ready!', 'green');
        this.log('Completed in', 'cyan', elapsedFormat, 'magenta', 'seconds', 'cyan');
        this.log('----------', 'magenta');

        if (_.isFunction(callback)) {
            callback();
        }
    },
    // log verbose messages if configured
    verbose: function(cmd, stdout, stderr) {
        if (this.getConfig('verbose')) {

            console.log('-----\n' + cmd.replace(/;/g, '\n') + '\n-----');

            if (stdout) {
                console.log(stdout);
            }
            if (stderr) {
                console.log(stderr);
            }
        }
    },
    // execute a background command
    runCommand: function(cmd) {
        var deferred = Q.defer(),
            $this = this,
            stdout = '',
            stderr = '',
            isVerbose = this.getConfig('verbose'),
            bgCmd = exec(cmd);

        if (isVerbose) {
            console.log('-----\n' + cmd.replace(/;/g, '\n') + '\n-----');
        }

        // on standard output
        bgCmd.stdout.on('data', function(data) {
            stdout += data;

            if (isVerbose) {
                process.stdout.write(data);
            }
        });
        // on standard error
        bgCmd.stderr.on('data', function(data) {
            stderr += data;

            if (isVerbose) {
                process.stdout.write(data);
            }
        });
        // once finished
        bgCmd.on('close', function() {
            deferred.resolve(stdout, stderr);
        });
        // on an error
        bgCmd.on('error', function(err) {
            console.log(err);
            deferred.reject(err);
            return deferred.promise;
        });

        return deferred.promise;
    }
};

// Wrap string in single quotes
function wrapQuotes(str) {
    return '\'' + str + '\'';
}

// Convert bytes to readable filesize
function bytesToSize(bytes) {
   var sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
   if (bytes == 0) return '0 Byte';
   var i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
   return Math.round(bytes / Math.pow(1024, i), 2) + ' ' + sizes[i];
}
