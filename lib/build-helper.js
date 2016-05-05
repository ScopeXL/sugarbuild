var Q = require('q'),
    fs = require('fs.extra'),
    rimraf = require('rimraf'),
    _ = require('underscore'),
    moment = require('moment'),
    path = require('path'),
    exec = require('child_process').exec,
    childProcess = require('child_process'),
    phantomjs = require('phantomjs-prebuilt'),
    http = require('http'),
    binPath = phantomjs.path,
    phantomHelper = require('./phantom-install-helper'),
    config = require('../config.json'),
    startTime = new moment();

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

            console.log(chalk.gray('[' + timestamp + ']') + ' ' + logMsg);
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
                Q.when($this.copyFile(filename)).then(function() {
                    $this.log('✔ ' + filename, 'green');
                }, function(err) {
                    console.log(err);
                    throw err;
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
            exec(cmd, function(err, response, stderr) {
                $this.verbose(cmd, response, stderr);
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

        exec(cmd, function(err, response, stderr) {
            $this.verbose(cmd, response, stderr);
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
            // rm -rf ${BUILD_DIR}/${FLAV}/*
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

                exec(cmd, function(err, response, stderr) {
                    $this.verbose(cmd, response, stderr);
                    if (response.indexOf('DONE') >= 0) {
                        $this.log('Build complete', 'green');
                        deferred.resolve();
                    } else {
                        $this.log(phpResponse, 'red');
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

            exec(cmd, function(err, response, stderr) {
                    $this.verbose(cmd, response, stderr);

                    if (response.indexOf('Finished \'default\'') >= 0) {
                        $this.log('Sidecar built', 'green');
                        deferred.resolve(true);
                    } else {
                        $this.log(response, 'red');
                        deferred.reject();
                    }
                }
            );

            return deferred.promise;
        }
    },
    createDatabase: function() {
        var deferred = Q.defer(),
            $this = this,
            cmd = 'mysql ' +
                '--host="' + config.sugar_config_si.setup_db_host_name + '" ' +
                '--user="' + config.sugar_config_si.setup_db_admin_user_name + '" ' +
                '--password="' + config.sugar_config_si.setup_db_admin_password + '" ' +
                '-e \'CREATE DATABASE IF NOT EXISTS `' + config.sugar_config_si.setup_db_database_name + '`\'';

        exec(cmd, function(err, response, stderr) {
            $this.verbose(cmd, response, stderr);
            deferred.resolve();
        });

        return deferred.promise;
    },
    install: function() {
        var deferred = Q.defer(),
            $this = this,
            checkInterval,
            installData = '',
            cmd = '';

        if (!this.getConfig('installSugar')) {
            deferred.resolve();
        } else {
            // run installation
            this.log('Installing SugarCRM' +
                (this.getConfig('installDemoData') ? ' with Demo Data' : '') + '...', 'yellow'
            );

            var childArgs = [
                path.join(__dirname, 'phantom-install.js'),
                this.getConfig('baseWebUrl') + '/' + this.getConfig('flavor') +
                    '/install.php?goto=SilentInstall&cli=true'
            ];

            var phantomInstall = childProcess.execFile(binPath, childArgs);
            phantomInstall.stdout.on('data', function(data) {
                installData = data;
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
                installData = '';

                $this.log('Installation Complete', 'green');

                if (!$this.getConfig('createSqlDump')) {
                    // do not create a dump file
                    deferred.resolve();
                } else {
                    // get the current branch
                    Q.when($this.getCurrentBranch()).then(function(branchName) {
                        cmd = 'mysqldump ' +
                            '--host="' + config.sugar_config_si.setup_db_host_name + '" ' +
                            '--user="' + config.sugar_config_si.setup_db_admin_user_name + '" ' +
                            '--password="' + config.sugar_config_si.setup_db_admin_password + '" ' +
                            '--add-drop-database --databases ' + config.sugar_config_si.setup_db_database_name +
                            ' > ' +
                            path.join($this.getConfig('sqlDumpDir'), branchName + '.sql');

                        $this.log('Creating SQL dump file', 'yellow');

                        // check if the dump directory exists
                        if (!$this.checkFileExists($this.getConfig('sqlDumpDir'))) {
                            // dump directory does not exist, create it
                            fs.mkdirpSync($this.getConfig('sqlDumpDir'));
                        }

                        exec(cmd, function(err, response, stderr) {
                            $this.verbose(cmd, response, stderr);
                            // cleanup phantom helper variables
                            phantomHelper.cleanup();

                            $this.log('SQL dump file created at', 'green',
                                path.join($this.getConfig('sqlDumpDir'), branchName + '.sql'), 'magenta'
                            );

                            deferred.resolve();
                        });
                    }, function(err) {
                        deferred.reject(err);
                    });
                }
            });
        }

        return deferred.promise;
    },
    // before we actually import data, figure out how it needs to be handled
    preImport: function() {
        var deferred = Q.defer(),
            $this = this,
            sqlDumpLocation = '',
            sqlDumpData = '';

        if (_.isEqual(this.getConfig('importDumpFile').substring(0, 7), 'http://')) {
            // SQL dump file is a URL
            sqlDumpLocation = this.getConfig('importDumpFile');

            // get the data from the URL
            http.get(sqlDumpLocation, function(res) {
                // merge the response data
                res.on('data', function(chunk) {
                    sqlDumpData += chunk;
                });

                // when we received all data
                res.on('end', function() {
                    // write the data to a temp file
                    fs.writeFile(path.join(__dirname, 'tmp-import.sql'), sqlDumpData, 'utf8', function(err) {
                        if (err) {
                            deferred.reject(err);
                        }

                        deferred.resolve(path.join(__dirname, 'tmp-import.sql'));
                    });
                });

            }).on('error', function(e) {
                $this.log('Error: ' + e.message, 'red');
            });

        } else {
            // SQL dump file is a file name
            sqlDumpLocation = path.join(this.getConfig('sqlDumpDir'), this.getConfig('importDumpFile')) + '.sql';
            deferred.resolve(sqlDumpLocation);
        }

        return deferred.promise;
    },
    // import demo data from a SQL dump file
    import: function() {
        var deferred = Q.defer(),
            $this = this,
            cmd = 'mysql ' +
                '--host="' + config.sugar_config_si.setup_db_host_name + '" ' +
                '--user="' + config.sugar_config_si.setup_db_admin_user_name + '" ' +
                '--password="' + config.sugar_config_si.setup_db_admin_password + '" ' +
                config.sugar_config_si.setup_db_database_name + ' < ' +
                path.join(this.getConfig('sqlDumpDir'), this.getConfig('importDumpFile') + '.sql');

        // do we import an SQL dump file?
        if (this.getConfig('importDemoData') && !this.getConfig('installDemoData')) {
            // only import demo data if installDemoData is false
            if (_.isEmpty(this.getConfig('importDumpFile'))) {
                this.log('Import SQL File cannot be blank. Skipping...', 'yellow');
                deferred.resolve();
            } else {
                this.log('Starting import procedure...', 'yellow');

                Q.when(this.preImport()).then(function(sqlDumpLocation) {
                    // import procedure is complete, now import the data based on the sqlDumpLocation
                    $this.log('Importing demo data from', 'yellow', sqlDumpLocation, 'magenta');

                    exec(cmd, function(err, response, stderr) {
                        $this.verbose(cmd, response, stderr);
                        // Remove temporary import file if it exists
                        if ($this.checkFileExists(sqlDumpLocation)) {
                            // remove the file
                            fs.unlinkSync(sqlDumpLocation);
                        }

                        $this.log('Import complete', 'green');
                        deferred.resolve();
                    });
                }, function(err) {
                    throw err;
                });
            }
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
            configObj.setup_db_database_name = 'sugar7' + this.getConfig('flavor');
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
            $this = this,
            cmd = 'cd ' + this.getConfig('sourceDir') + ';' +
                'git checkout ' + branch;

        exec(cmd, function(err, response, stderr) {
            $this.verbose(cmd, response, stderr);
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

        exec(cmd, function(err, response, stderr) {
            $this.verbose(cmd, response, stderr);
            if (err) {
                deferred.reject(err);
            }
            // (HEAD detached at upstream/master)
            if (response.indexOf('HEAD detached at') >= 0) {
                // need to strip away everything but the git branch
                response = response.replace('HEAD detached at', '');
            }

            // if branch has remote/branch
            if (response.indexOf('/') >= 0) {
                var info = response.split('/');
                // only include the branch name
                response = info[1];
            }

            // return the branch name stripping away parentheses and whitespace
            response = response.replace(/\s|\(|\)/g, '');
            deferred.resolve(response);
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
                    var fullFilePath = path.join(filePath, file);

                    if (_.isEqual(file.substring(0, 1), '.')) {
                        // ignore files meant to be ignored
                        return;
                    }

                    try {
                        var dataFileStats = fs.statSync(fullFilePath);
                        tmpFiles.push({
                            path: fullFilePath,
                            // strip path and extenstion from file
                            name: path.basename(fullFilePath, '.sql'),
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
        var $this = this;
        // reset the start time
        startTime = new moment();
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
        Q.when(this.install()).then(function() {
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
