#!/usr/bin/env node

var Q = require('q'),
    build = require('./lib/build-helper'),
    moment = require('moment'),
    _ = require('underscore'),
    express = require('express'),
    path = require('path'),
    isBuilding = false,
    branches = null,
    interval = moment.duration(3, 'hours').asMilliseconds(),
    nextSchedule = new moment().add(interval, 'milliseconds'),
    scheduledRun = null,
    currentBranchIndex = 0;

// check for command line arguments and overwrite config accordingly
build.checkCommandLineArgs();

// Do a version check
build.versionCheck();

if (build.getConfig('enableWebServer')) {
    // start the web server
    initWebServer();
}

if (build.getConfig('watchChanges')) {
    build.watchChanges();
    // we are watching the sugarcrm directory for file changes
    build.log('Listening for changes to the sugarcrm directory...', 'gray');
}

// Start Mailcatcher
// if (build.getConfig('mailcatcher')) {
//     build.mailcatcher({
//         logOutput: true
//     });
//     build.log('Enabling Mailcatcher...', 'gray');
// }

// do not build from command line when build admin is loaded. Use Web GUI instead
if (!build.getConfig('buildAdmin')) {
    if (build.getConfig('enableBuildSchedule')) {
        // list configuration before build initialize
        build.listConfig();
        // run as a service building multiple branches
        branches = build.getConfig('branches');

        if (_.isArray(branches)) {
            // ignore watch for changes setting as this is used for single builds
            if (build.getConfig('watchChanges')) {
                build.setConfig('watchChanges', false);
                build.log('No longer watching for changes, use only for single builds', 'yellow');
            }
            // start the build process for the branches
            initBuildSchedule(branches);
        }
    } else if (build.getConfig('watchOnly')) {
        // watch for changes without building
        //build.watchChanges();

        if (build.getConfig('enableWebServer')) {
            build.log('Web Server Listening on:', 'gray',
                'http://localhost:' + build.getConfig('webServerPort'), 'magenta'
            );
        }
    } else {
        // list configuration before build initialize
        build.listConfig();
        // single build instance
        build.full();
    }
} else {
    build.log('Use Web Admin Interface:', 'gray',
        'http://localhost:' + build.getConfig('webServerPort'), 'magenta'
    );
}

// Start the web server
function initWebServer() {
    var app = express();
    app.set('view engine', 'pug');
    app.set('views', path.join(__dirname, 'views'));
    //app.use(express.static(path.dirname(require.main.filename)));

    app.get('/', function(req, res) {
        res.redirect('/build');
        /*res.render('build', {
            config: build.fullConfig()
        });*/
        /*res.sendFile(
            path.join(
                path.dirname(require.main.filename),
                'views',
                'build.html'
            )
        );*/
    });

    app.get('/build', function(req, res) {
        Q.when(build.fileList(build.getConfig('sqlDumpDir'))).then(function(files) {
            res.render('index', {
                files: files
            });
        }, function(err) {
            res.send('An error occured');
        });
    });

    app.get('/build/data/:branch', function(req, res) {
        var branch = req.params.branch,
            dataFileLocation = path.join(build.getConfig('sqlDumpDir'), branch + '.sql');

        // if the branch parameter is empty
        if (_.isEmpty(branch)) {
            res.send('Branch cannot be empty');
            return;
        }

        // only download the file if it exists
        if (!build.checkFileExists(dataFileLocation)) {
            res.send('No data file for (' + branch + ') found.');
            return;
        }

        res.setHeader('Content-Type', 'text/plain');
        Q.when(build.readFile(dataFileLocation)).then(function(data) {
            res.send(data);
            build.log('Served export file:', 'gray', branch, 'cyan');
        }, function(err) {
            res.send('An error occured');
        });
    });

    app.get('/build/css/index.css', function(req, res) {
        res.sendFile(path.join(__dirname, 'css', 'index.css'));
    });

    app.listen(build.getConfig('webServerPort'));
}

// initialize the build schedule
function initBuildSchedule() {
    buildInstance();

    scheduledRun = setInterval(function() {
        if (!isBuilding) {
            var currentTimestamp = new moment();

            if (nextSchedule.unix() <= currentTimestamp.unix()) {
                // restart the build process
                currentBranchIndex = 0;
                buildInstance();

                nextSchedule = new moment().add(interval, 'milliseconds');
            }
        }
    }, 30000);
}

function buildInstance() {
    isBuilding = true;

    Q.when(build.switchBranch(branches[currentBranchIndex])).then(function() {
        build.log('Branch switched to', 'green', branches[currentBranchIndex], 'magenta');
        // set the sql dump file name to the branch name
        build.setConfig('importDumpFile', branches[currentBranchIndex]);
        // set the current branch
        build.setConfig('currentBranch', branches[currentBranchIndex]);
        // force set the flavor to ent
        build.setConfig('flavor', 'ent');
        build.log('Flavor set to', 'cyan', 'ent', 'magenta');
        build.full(function() {
            // current build is complete
            // force set the flavor to pro
            build.setConfig('flavor', 'pro');
            build.log('Flavor set to', 'cyan', 'pro', 'magenta');
            build.full(function() {
                // increase build index
                currentBranchIndex++;

                if (!_.isUndefined(branches[currentBranchIndex])) {
                    build.log('Next build will begin in 10 seconds...', 'gray');
                    setTimeout(buildInstance, 10000);
                } else {
                    // all builds finished
                    isBuilding = false;
                    build.log('Next run is scheduled for', 'cyan', nextSchedule.format('MMMM Do, HH:mm:ss'), 'magenta');
                }
            });


        });
    });
}
