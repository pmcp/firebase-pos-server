// Start: nodemon index.js
const admin = require('firebase-admin')

const express = require('express')

const app = express()

app.use(express.json({ type: '*/*' }))
// app.use(express.urlencoded({ extended: true }))

app.listen(3001)
const ThermalPrinter = require('node-thermal-printer').printer
const PrinterTypes = require('node-thermal-printer').types
const serviceAccount = require('./key.json')

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
})

const db = admin.firestore()
let printers = {}
let printersPerLocation = {}

const updatePrintStatus = function(ref, status) {
  const refDoc = db.doc(ref)
  refDoc.update({
    printStatus: status
  })
}


async function createPrinter(printer) {
  console.log(`Checking printer ${printer.name} at ${printer.location} with ip ${printer.ip}`)
  return new Promise(async (resolve, reject) => {
    const device = new ThermalPrinter({
      type: PrinterTypes.EPSON,
      interface: `tcp://${printer.ip}`,
    })
    const isConnected = await device.isPrinterConnected()
    console.log(`printer ${printer.name} at ${printer.location} with ip ${printer.ip} is connected: ${isConnected}`)
    if(isConnected) {
      // Send message to signal "Printers Is Go!"
      device.println(`Printer ${printer.location} is verbonden!`)
      device.drawLine()
      device.cut()
      device.execute()

      resolve({device: device, info: printer});
    } else {
      reject(`printer ${printer.name} at ${printer.location} with ip ${printer.ip} is not connected.`);
    }
    // Make an asynchronous call and either resolve or reject
  });

}

async function getPrintersFromDb() {
  console.log('getting printers from db')
  const printers = []
  const allPrinters = await db.collection('printers').get();
  for(const doc of allPrinters.docs){
    // Only add active printers
    if(doc.data().active !== true) return
    printers.push(doc.data())
  }
  return printers
}

async function printLocation(location, printer, table) {
  return new Promise(async (resolve, reject) => {

    let isConnected = await printer.device.isPrinterConnected();
    if(!isConnected) {
      console.log(`Printer with ip ${printer.info.ip} at ${printer.info.location} is not connected`)
      reject(`printer ${printer.name} at ${printer.location} with ip ${printer.ip} is not connected.`);
    } else {

      // Check if there are actually products for this location
      printer.device.alignCenter()
      printer.device.bold(true)
      printer.device.println('Concertband Armonia')
      printer.device.setTextQuadArea()
      printer.device.println('Vlaamse Kermis 2022')
      printer.device.alignLeft()
      printer.device.setTextNormal()
      printer.device.newLine()
      printer.device.bold(false)
      printer.device.println('Tafelnummer: ' + table.table)
      // printer.println('Besteld door: ' + waiter.displayName)
      printer.device.drawLine()


      let totalPrice = 0
      let totalNumber = 0

      for (const line in location.orders) {
        // Skip line if value (number of products) is 0
        const entry = location.orders[line]
        if(entry.value === 0) continue
        console.log(entry)
        const total = (entry.price * entry.value).toFixed(1);
        totalPrice += entry.price * entry.value
        totalNumber += entry.value
        printer.device.tableCustom([
          { text: entry.value, align: 'LEFT', width: 0.1 },
          { text: entry.name, align: 'LEFT', width: 0.4 },
          { text: entry.price, align: 'RIGHT', width: 0.2 },
          { text: total, align: 'RIGHT', width: 0.2 }
        ])
      }

      printer.device.drawLine()
      printer.device.tableCustom([
        { text: totalNumber, align: 'LEFT', width: 0.1 },
        { text: 'Totaal', align: 'LEFT', width: 0.6 },
        { text: totalPrice.toFixed(1), align: 'RIGHT', width: 0.2 }
      ])
      printer.device.newLine()
      printer.device.drawLine()
      printer.device.drawLine()
      printer.device.cut()
      printer.device.execute()

      // Done with printing
      resolve()
    }
  });

}

async function createOrders(printers, locations, table, waiterId, remarksMain) {
  // TODO: get info waiter here
  const locationsAsArray = Object.entries(locations).map(entry => {
    return {orders: entry[1], location: entry[0]};
  });

  return Promise
    .all(
        locationsAsArray.map(async (location) => {
          // If no orders in this order, skip
          let total = 0
          for (var key in location.orders) {
            if (location.orders.hasOwnProperty(key)) {
              total = total + location.orders[key].value
            }
          }

          if(total > 0) return await printLocation(location, printers[location.location], table);
          return;
        })
    )
    .then(values => {
      return { 'error': false, 'message': 'All prints are done!'}
    })
    .catch(error => {
      return { 'error': true, 'messages': error}
    });
}

function continousCheckQueue({ printers }) {
  return db
    .collection('orders')
    .where('printStatus', '==', 0)
    .onSnapshot(querySnapshot => {
      querySnapshot
        .docChanges()
        .forEach(async change => {
          console.log('got a non printed order')
          if (change.type === 'added' && change.doc.data().printStatus === 0) {
            // PrintStatus: 0 = to print, 1 = done, 2 = doing
            updatePrintStatus(change.doc.ref.path, 2)

            const locations = change.doc.data().products
            const table = change.doc.data().user
            const waiterId = change.doc.data().waiter
            const remarksMain = change.doc.data().remarks
            const createdOrders = await createOrders(printers, locations, table, waiterId, remarksMain)

            console.log(createdOrders)
            if(createdOrders.error) {
              console.log(createdOrders.message)
            } else {
              console.log('Done printing')
              updatePrintStatus(change.doc.ref.path, 1)
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
}

async function getPrinters(printers) {
  console.log('Getting printers')
  return Promise
    .all(
      printers.map(async (printer) => {
        return await createPrinter(printer);
      })
    )
    .then(values => {
      // Create object from array
      const printersPerLocation = values.reduce(
          (prev, curr) => {
            prev[curr.info.location] = curr
            return prev
          }, {}
      );
      return { 'error': false, 'message': 'All printers are go!', printersPerLocation}
    })
    .catch(error => {
      return { 'error': true, 'message': error}
    });
}

async function start() {
  const printers = await getPrintersFromDb()
  console.log(`In db are ${printers.length} printers`)
  const checkedPrinters = await getPrinters(printers)
  // TODO: signal issue somewhere: maybe signal all devices. So: update firebase
  if(checkedPrinters.error) return;
  // All printers are good, let's go
  // Check queue for orders, this will be a continuous check (onSnapshot)
  const printersPerLocation = checkedPrinters.printersPerLocation
  await continousCheckQueue({ printers: printersPerLocation})
}

start()

