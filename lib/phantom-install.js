var page = require('webpage').create(),
    system = require('system'),
    t,
    address,
    statusItems,
    checkItemsInterval;

if (system.args.length === 1) {
    console.log('Usage: build.js <some URL>');
    phantom.exit();
}

t = Date.now();
address = system.args[1];

// Setup the status items to check against
//initStatusItems();

page.open(address, function(status) {
    if (status !== 'success') {
        console.log('Failed to load the address: ' + address);
    } else {
        t = Date.now() - t;
        //console.log('Loading ' + system.args[1]);
        console.log('-- Finished in: ' + t / 1000 + ' seconds');
  }
  phantom.exit();
});

run();
function run() {
    checkItemsInterval = setInterval(function() {
        var evalItems = page.evaluate(function() {
            if (
                typeof(document.getElementsByClassName('shell')) === 'undefined' ||
                document.getElementsByClassName('shell').length <= 0
            ) {
                return items;
            }

            var tableElem = document.getElementsByClassName('shell')[0].getElementsByTagName('tr'),
                content;

            // Sugar data is stored on the 3rd tr element
            if (tableElem.length >= 3) {
                content = tableElem[2].textContent;
                console.log(content);
            }

        });
    }, 500);
    //phantom.exit();
}

/**
 * When PhantomJS returns a console message, relay it to our client
 * @param {String} msg
 */
page.onConsoleMessage = function(msg) {
    console.log(msg);
};
