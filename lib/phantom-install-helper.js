var statusItems = initStatusItems();

module.exports = {
    // check for an item completion
    checkItems: function(content, callback) {
        // iterate each status item to check for matches
        for (var i = 0; i < statusItems.length; i++) {
            var item = statusItems[i];
            // skip item if it is already complete
            if (item.complete === true) {
                continue;
            }

            // item is incomplete, check the document
            if (content.indexOf(item.text) >= 0) {
                item.complete = true;
                callback(item.output);
            }
        }
    },
    // cleanup phantom variables once installation finishes
    cleanup: function() {
        //statusItems = null;
        statusItems = initStatusItems();
    }
};

// initialize the status items to check the DOM against
function initStatusItems() {
    return [
        newStatusItem(
            'Creating Sugar configuration file (config.php)',
            'Creating Sugar Configuration File...'
        ),
        newStatusItem(
            'Creating Sugar application tables, audit tables and relationship metadata',
            'Creating application/audit tables and relationship data...'
        ),
        newStatusItem(
            'Creating the database',
            'Creating the database...'
        ),
        newStatusItem(
            'Creating default Sugar data',
            'Creating default Sugar data...'
        ),
        newStatusItem(
            'Updating license information...',
            'Updating license information...'
        ),
        newStatusItem(
            'Creating default users...',
            'Creating default users...'
        ),
        newStatusItem(
            'Creating default reports...',
            'Creating default reports...'
        ),
        newStatusItem(
            'Creating default scheduler jobs...',
            'Creating default scheduler jobs...'
        ),
        newStatusItem(
            'Populating the database tables with demo data',
            'Inserting demo data...'
        )
        /*newStatusItem(
            'is now complete!',
            'Installation is complete!'
        )*/
    ];
}

// create a new status item to check against
function newStatusItem(searchText, outputText, isComplete) {
    if (typeof(isComplete) === 'undefined') {
        isComplete = false;
    }

    return {
        text: searchText,
        output: outputText,
        complete: isComplete
    };
}
