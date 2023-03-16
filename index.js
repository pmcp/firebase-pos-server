// Start: nodemon index.js
const admin = require('firebase-admin')

const express = require('express')

const app = express()

app.use(express.json({ type: '*/*' }))
// app.use(express.urlencoded({ extended: true }))

app.listen(3002)
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
    // resolve({device: device, info: printer});
    if(isConnected) {
      // Send message to signal "Printers Is Go!"
      device.println(`Printer ${printer.location} is verbonden!`)
      device.drawLine()
      device.cut()
      const print = await device.execute();
      device.clear()

      resolve({device: device, info: printer});
    } else {
      reject(`printer ${printer.name} at ${printer.location} with ip ${printer.ip} is not connected.`);
    }

  });

}

async function getPrintersFromDb() {
  console.log('getting printers from db')
  const printers = []
  const allPrinters = await db.collection('printers').get();
  console.log('got printers')
  for(const doc of allPrinters.docs){
    // Only add active printers
    if(doc.data().active !== true) return
    printers.push(doc.data())
  }
  return printers
}

async function printLocation(location, printer, table, dates) {
  return new Promise(async (resolve, reject) => {
    console.log('HERE', printer)
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
      printer.device.println('Eetfestijn 2023')
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


      // Convert to array
      const orderArray = Object.values(location.orders);
      const filteredArray = orderArray.filter(x => x.value*1 !== 0)
      const sortedOrder = filteredArray.sort((a, b) => (a.order*1 > b.order*1) ? 1 : -1)


      for (var i = 0; i < sortedOrder.length; i++) {
        const entry = sortedOrder[i]
        if(entry.name !== 'Opmerking Bar' && entry.name !== 'Opmerking Keuken' && entry.name !== 'Opmerking Dessert') {
          let total = (entry.price * entry.value).toFixed(1);
          const priceWithDecimal = (entry.price*1).toFixed(1);
          totalPrice += entry.price * entry.value
          totalNumber += entry.value
          printer.device.bold(true);
          const truncatedName = entry.name.substring(0,26);
          printer.device.tableCustom([
            { text: entry.value, align: 'LEFT', width: 0.1 },
            { text: truncatedName, align: 'LEFT', width: 0.55 },
            { text: 'x ' + priceWithDecimal, align: 'RIGHT', width: 0.15 },
            { text: '=', align: 'RIGHT', width: 0.05 },
            { text: total, align: 'RIGHT', width: 0.1 }
          ])
          printer.device.bold(false);                                         // Set text bold
        }

        if(entry.options.length > 0) {
          console.log(entry.options)
          for (let j = 0; j < entry.options.length; j++) {
            console.log(entry.options)
            const option = entry.options[i]
            printer.device.tableCustom([
              { text: '', align: 'LEFT', width: 0.1 },
              { text: option, align: 'LEFT', width: 0.78 }
            ])
          }
        }

        if(entry.remark) {
          if(entry.name === 'Opmerking Bar') {
            printer.device.newLine()
            printer.device.bold(true);
            printer.device.underline(true);
            printer.device.println('OPMERKING BAR');
            printer.device.bold(false);
            printer.device.underline(false);
            printer.device.println(entry.remark);
            printer.device.newLine();
          } else if(entry.name === 'Opmerking Dessert') {
            printer.device.newLine()
            printer.device.bold(true);
            printer.device.underline(true);
            printer.device.println('OPMERKING DESSERT');
            printer.device.bold(false);
            printer.device.underline(false);
            printer.device.println(entry.remark);
            printer.device.newLine();
          } else if(entry.name === 'Opmerking Keuken') {
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
              { text: '', align: 'LEFT', width: 0.1 },
              { text: entry.remark, align: 'LEFT', width: 0.78 },
            ])
          }




        }
      }



      printer.device.drawLine()
      printer.device.newLine()
      printer.device.bold(true);
      printer.device.tableCustom([
        { text: totalNumber, align: 'LEFT', width: 0.1 },
        { text: 'TOTAAL', align: 'LEFT', width: 0.65 },
        { text: totalPrice.toFixed(1), align: 'RIGHT', width: 0.2 }
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
    }
  });

}

async function createOrders(printers, locations, table, waiterId, remarksMain, dates) {
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
          if(total > 0) {
            return Promise
            .all(
              printers[location.location].map(async (printer) => {

                return await printLocation(location, printer, table, dates);
              })
            )
            .then(values => {
              return { 'error': false, 'message': 'All prints are done!'}
            })
            .catch(error => {
              return { 'error': true, 'messages': error}
            });
          }
          // console.log('is it this')
          // return await printLocation(location, printers[location.location], table);

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
          console.log('got a non printed order', change.doc.data().printStatus === 0)

          if (change.type === 'added' && change.doc.data().printStatus === 0) {

            // PrintStatus: 0 = to print, 1 = done, 2 = doing
            updatePrintStatus(change.doc.ref.path, 1)

            const locations = change.doc.data().products
            const table = change.doc.data().user
            const dates = {
             created: new Date(change.doc.data().createTimestamp.toMillis()).toDateString() + ' om ' + new Date(change.doc.data().createTimestamp.toMillis()).toLocaleTimeString([], {hour12: false}),
             printed: new Date().toDateString() + ' om ' + new Date().toLocaleTimeString([], {hour12: false})
            }

            const waiterId = change.doc.data().waiter
            const remarksMain = change.doc.data().remarks
            const createdOrders = await createOrders(printers, locations, table, waiterId, remarksMain, dates)

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
            if (prev[curr.info.location]) {
              prev[curr.info.location] = [...prev[curr.info.location], curr]
            } else {
              prev[curr.info.location] = [curr]
            }
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

process.on('uncaughtException', function (err) {
  console.error((new Date).toUTCString() + ' uncaughtException:', err.message)
  console.error(err.stack)
  process.exit(1)
})

