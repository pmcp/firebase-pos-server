// Start: nodemon index.js
const admin = require('firebase-admin')
const express = require('express')

const app = express()

app.use(express.json({type: '*/*'}))
// app.use(express.urlencoded({ extended: true }))

app.listen(3001)
const ThermalPrinter = require('node-thermal-printer').printer
const PrinterTypes = require('node-thermal-printer').types
const serviceAccount = require('./key.json')

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
})

const db = admin.firestore()

// If we run start, it will return the unsubscribe function for the firestore watcher
let unsubscribeOrders = null

const updatePrintStatus = function (ref, status) {
    const refDoc = db.doc(ref)
    refDoc.update({
        printStatus: status
    })
}

const createsystemNotification = async function (value) {
    // TODO: Add created time to value object
    const res = await db.collection('systemNotifications').add(value);
    console.log('Added notification with ID: ', res.id);
}

async function printLocation(location, printer, table, dates) {
    return new Promise(async (resolve, reject) => {
        // Get the settings from the firestore
        const dbSettings = await getSettingsFromDb()
        printer.device.alignCenter()
        printer.device.bold(true)
        printer.device.println(dbSettings.organisation)
        printer.device.setTextQuadArea()
        printer.device.println(dbSettings.event)
        printer.device.alignLeft()
        printer.device.setTextNormal()
        printer.device.newLine()
        printer.device.println('TAFEL: ' + table.table)
        printer.device.bold(false)
        printer.device.println('BESTELD: ' + dates.created)
        printer.device.newLine()
        // printer.println('Besteld door: ' + waiter.displayName)
        printer.device.drawLine()
        printer.device.newLine()

        let totalPrice = 0
        let totalNumber = 0

        for (var i = 0; i < location.orders.length; i++) {
            const entry = location.orders[i]
            if (entry.name !== 'Opmerking Bar' && entry.name !== 'Opmerking Keuken' && entry.name !== 'Opmerking Dessert') {
                let total = (entry.price * entry.value).toFixed(1);
                const priceWithDecimal = (entry.price * 1).toFixed(1);
                totalPrice += entry.price * entry.value
                totalNumber += entry.value
                printer.device.bold(true);
                const truncatedName = entry.name.substring(0, 26);
                printer.device.tableCustom([
                    {text: entry.value, align: 'LEFT', width: 0.1},
                    {text: truncatedName, align: 'LEFT', width: 0.55},
                    {text: 'x ' + priceWithDecimal, align: 'RIGHT', width: 0.15},
                    {text: '=', align: 'RIGHT', width: 0.05},
                    {text: total, align: 'RIGHT', width: 0.1}
                ])
                printer.device.bold(false);                                         // Set text bold
            }

            if (entry.options.length > 0) {
                for (let j = 0; j < entry.options.length; j++) {
                    const option = entry.options[j]
                    printer.device.tableCustom([
                        {text: '', align: 'LEFT', width: 0.1},
                        {text: option, align: 'LEFT', width: 0.78}
                    ])
                }
            }

            if (entry.remark) {
                if (entry.name === 'Opmerking Bar') {
                    printer.device.newLine()
                    printer.device.bold(true);
                    printer.device.underline(true);
                    printer.device.println('OPMERKING BAR');
                    printer.device.bold(false);
                    printer.device.underline(false);
                    printer.device.println(entry.remark);
                    printer.device.newLine();
                } else if (entry.name === 'Opmerking Dessert') {
                    printer.device.newLine()
                    printer.device.bold(true);
                    printer.device.underline(true);
                    printer.device.println('OPMERKING DESSERT');
                    printer.device.bold(false);
                    printer.device.underline(false);
                    printer.device.println(entry.remark);
                    printer.device.newLine();
                } else if (entry.name === 'Opmerking Keuken') {
                    printer.device.newLine()
                    printer.device.bold(true);
                    printer.device.underline(true);
                    printer.device.println('OPMERKING KEUKEN');
                    printer.device.bold(false);
                    printer.device.underline(false);
                    printer.device.println(entry.remark);
                    printer.device.newLine();
                } else {
                    printer.device.tableCustom([
                        {text: '', align: 'LEFT', width: 0.1},
                        {text: entry.remark, align: 'LEFT', width: 0.78},
                    ])
                }
            }
        }

        printer.device.drawLine()
        printer.device.newLine()
        printer.device.bold(true);
        printer.device.tableCustom([
            {text: totalNumber, align: 'LEFT', width: 0.1},
            {text: 'TOTAAL', align: 'LEFT', width: 0.65},
            {text: totalPrice.toFixed(1), align: 'RIGHT', width: 0.2}
        ])
        printer.device.bold(false);
        printer.device.cut()

        try {
            let execute = printer.device.execute()
            console.error("Print done!");
            printer.device.clear()
            resolve()
        } catch (error) {
            console.log("Print failed:", error);
            reject(error)
        }
    });
}

async function createOrders(printers, locations, table, waiterId, remarksMain, dates) {
    // TODO: get info waiter here
    return Promise
        .all(
            locations.map(async (location) => {
                return Promise
                    .all(
                        printers[location.location].map(async (printer) => {
                            return await printLocation(location, printer, table, dates);
                        })
                    )
                    .then(values => {
                        return {'error': false, 'message': 'All prints are done!'}
                    })
                    .catch(error => {
                        return {'error': true, 'messages': error}
                    });
            })
        )
        .then(values => {
            return {'error': false, 'message': 'All prints are done!'}
        })
        .catch(error => {
            return {'error': true, 'messages': error}
        });
}

function organisePrintersPerLocation(printers) {
    return printers.reduce(
        (prev, curr) => {
            if (prev[curr.location]) {
                prev[curr.location] = [...prev[curr.location], curr]
            } else {
                prev[curr.location] = [curr]
            }
            return prev
        }, {}
    );
}

async function continousCheckOrderQueue(printers) {
    const unsub = db
        .collection('orders')
        .where('printStatus', '==', 0)
        .onSnapshot(querySnapshot => {
            querySnapshot
                .docChanges()
                .forEach(async change => {
                    console.log('got a non printed order', change.doc.data().printStatus === 0)
                    if (change.type === 'added' && change.doc.data().printStatus === 0) {
                        // PrintStatus: 0 = to print, 1 = done
                        const locations = change.doc.data().products
                        const table = change.doc.data().user
                        const dates = {
                            created: new Date(change.doc.data().createTimestamp.toMillis()).toDateString() + ' om ' + new Date(change.doc.data().createTimestamp.toMillis()).toLocaleTimeString([], {hour12: false}),
                            printed: new Date().toDateString() + ' om ' + new Date().toLocaleTimeString([], {hour12: false})
                        }
                        const waiterId = change.doc.data().waiter
                        const remarksMain = change.doc.data().remarks
                        // Create an array of objects, with a location, and the orders of this location
                        const locationsAsArray = Object.entries(locations).map(entry => {
                            return {orders: entry[1], location: entry[0]};
                        });
                        // Create an array of the orders (is now object of objects)
                        const locationsAsArrayWithOrdersAsArray = locationsAsArray.map(location => {
                            const orderArray = Object.values(location.orders);
                            // Filter out products with value 0
                            const filteredArray = orderArray.filter(x => x.value * 1 !== 0)
                            // Sort products
                            const sortedOrder = filteredArray.sort((a, b) => (a.order * 1 > b.order * 1) ? 1 : -1)
                            return {...location, orders: sortedOrder}
                        })
                        // Filter out the printer without orders
                        const locationsWithoutTheOnesWithoutOrders = locationsAsArrayWithOrdersAsArray.filter(l => l.orders.length > 0)

                        // Check if all printers we need are online
                        let allPrintersActive = true
                        for (let i = 0; i < locationsWithoutTheOnesWithoutOrders.length; i++) {
                            const location = locationsWithoutTheOnesWithoutOrders[i].location
                            // Check if printers in this location are online
                            console.log('coming from check', printers[location])
                            // If no active printers are in the location, printers[location] will return undefined.
                            // In that case connectedPrinters is empty.
                            let connectedPrinters = []
                            let printersForLocationActive = true
                            if(printers[location] !== undefined) {
                                connectedPrinters = await setPrinterConnectionStatus(printers[location])
                                // console.log(location, connectedPrinters)
                                // Check if all printers for this location are connected
                                // TODO: Some error here: "Cannot read properties of undefined (reading 'status')"
                                for (let j = 1; j < connectedPrinters.length; j++) {
                                    const printer = connectedPrinters[i]
                                    // console.log(printer)
                                    if (printer.status === -1) {
                                        console.log('I AM HERE')
                                        printersForLocationActive = false
                                        break
                                    }
                                }
                            }


                            // set overall printers active to false if one printer needed in this order is not active
                            if (printersForLocationActive === false) {
                                allPrintersActive = false;
                                break
                            }
                        }
                        // If one of the printers is out, don't print this order.
                        if (allPrintersActive === false) {
                            console.log('Not all printers needed are connected')
                            createsystemNotification({
                                type: -1,
                                message: 'Not all needed printers are connected.',
                                order: change.doc.ref.path
                            })
                            return;
                        }
                        // print the orders
                        const createdOrders = await createOrders(printers, locationsWithoutTheOnesWithoutOrders, table, waiterId, remarksMain, dates)

                        if (createdOrders.error) {
                            // TODO: If it makes sense to use error code on the order, this is the place to do it. I should then change the firebase watcher to include -1
                            // updatePrintStatus(change.doc.ref.path, -1)
                            console.log(createdOrders.message)
                            createsystemNotification({
                                type: -1,
                                message: createdOrders.message,
                                order: change.doc.ref.path
                            })

                        } else {
                            console.log('Done printing')
                            // Change the print status in the order, to indicate it is done
                            updatePrintStatus(change.doc.ref.path, 1)
                            await createsystemNotification({
                                type: 1,
                                message: createdOrders.message,
                                order: change.doc.ref.path
                            })
                            return

                        }
                    }

                    if (change.type === 'modified') {
                        console.log('ORDER MODIFIED')
                    }
                    if (change.type === 'removed') {
                        console.log('ORDER REMOVED')
                    }
                })
        })

    return unsub
}

const updatePrinterStatus = function (ref, value) {
    const refDoc = db.collection('printers').doc(ref)
    refDoc.update({
        status: value
    })
}

async function addDeviceToPrinter(printerTypes, ip) {
    return new ThermalPrinter({
        type: PrinterTypes.EPSON,
        interface: `tcp://${ip}`,
    })

}

async function getPrintersFromDb() {
    const printers = []
    const allPrinters = await db.collection('printers')
        .where('active', '==', true)
        .get();
    for (const doc of allPrinters.docs) {
        // Only add active printers
        let data = doc.data()
        data.fbRef = doc.id
        printers.push(data)
    }
    return printers
}

async function getSettingsFromDb() {
    const settingsRef = db.collection('settings').doc('printInfo');
    const doc = await settingsRef.get();
    if (!doc.exists) {
        console.log('No such document!');
    } else {
        console.log('Document data:', doc.data());
    }
    return doc.data()
}

async function setPrinterConnectionStatus(printers) {

    if(printers === undefined) {
        console.log('PRINTERS UNDEFINED',printers)
    }

    return await Promise.all(
        printers.map(async (printer) => {

            const connected = await printer.device.isPrinterConnected()
            console.log(connected)
            let status;
            if (connected) {
                console.log(`printer ${printer.name} is connected`)
                status = 1
            } else {
                console.log(`printer ${printer.name} is NOT connected`)
                status = -1
            }
            updatePrinterStatus(printer.fbRef, status)
            return {...printer, status}
        })
    )
}

async function startPrintFlow() {
    // if there is already a watcher for order changes, unsubscribe
    if (unsubscribeOrders !== null) unsubscribeOrders()
    // Get printers from database
    const dbPrinters = await getPrintersFromDb()
    // Only use active printers
    const activePrinters = dbPrinters.filter(p => p.active)
    // For each printer: add an Epson device
    const printersWithDevice = await Promise.all(
        activePrinters.map(async (p) => {
            const printerWithDevice = await addDeviceToPrinter(PrinterTypes, p.ip)
            return {device: printerWithDevice, ...p}
        })
    )

    // Check if each Epson Device is connected
    console.log('coming from start')
    const connectedPrinters = await setPrinterConnectionStatus(printersWithDevice)
    // organise printers per location
    const printersPerLocation = organisePrintersPerLocation(connectedPrinters)
    // Check queue for orders, this will be a continuous check (onSnapshot)
    console.log('Starting watcher orders')
    unsubscribeOrders = await continousCheckOrderQueue(printersPerLocation)
}

function start() {
    // Start with the printer & order flow
    startPrintFlow()
    // Start watching printers, if we change a printer's active status, restart the print flow
    db
        .collection('printers')
        .onSnapshot(querySnapshot => {
            querySnapshot
                .docChanges()
                .forEach(async change => {
                    if (change.type === 'modified') {
                        console.log('PRINTER MODIFIED')
                        startPrintFlow()
                    }
                })
        })
}

// Start the flow by creating a watcher for printer updates from firestore
start()

process.on('uncaughtException', function (err) {
    console.error((new Date).toUTCString() + ' uncaughtException:', err.message)
    console.error(err.stack)
    process.exit(1)
})

