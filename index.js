// Start: nodemon index.js
const admin = require('firebase-admin')

const express = require('express')

const app = express()

app.use(express.json({ type: '*/*' }))
// app.use(express.urlencoded({ extended: true }))

app.listen(3001)
console.log('Listening on port 3001...')

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

function checkFirebaseQueue(ref, order) {
  const products = order.products
  const table = order.user.table
  let waiter = {}

  // Get waiter
  db.collection('users').doc(order.waiter).get().then((waiter) => {
    waiter = waiter.data()



    // products are grouped by printer, so we loop the printers
    for (const location in products) {
      console.log('PRODUCTS PER LOCATION')
      console.log(location)
      console.dir(products[location])

      // Get printers with this location
      db.collection('printers')
        .where('location', '==', location)
        .onSnapshot(querySnapshot => {
          querySnapshot.forEach(doc => {
            // {
            //   printStatus: 0,
            //     createTimestamp: Timestamp { _seconds: 1583018108, _nanoseconds: 101000000 },
            //   user: { id: '8LrfqzTYXhzJXYUKOUfz', name: 'test 1', table: '1' },
            //   remarks: '',
            //     totals: { hoofgerecht: 4, drank: 7 },
            //   waiter: 'Hv8nUJxNB4gri1wr65mBAWt6d102',
            //     updateTimestamp: Timestamp { _seconds: 1583018108, _nanoseconds: 101000000 },
            //   products: {
            //     bar: { XgJcJnh5kqrmpYdX4U32: [Object], tdGQZ2nZHMxNpXkJ0Q08: [Object] },
            //     keuken: { YdDgklDQvcr8qJsG1f5H: [Object] }
            //   },
            //   total: 11
            // }

            let totalPrice = 0
            let totalNumber = 0
            const printer = new ThermalPrinter({
              type: PrinterTypes.EPSON,
              interface: `tcp://${doc.data().ip}`,
            })
            printer.alignCenter()
            printer.bold(true)
            printer.println('Koninklijke Fanfare De Eendracht')
            printer.setTextQuadArea()
            printer.println('Vlaamse Kermis 2022')
            printer.alignLeft()
            printer.setTextNormal()
            printer.newLine()
            printer.bold(false)
            printer.println('Tafelnummer: ' + table)
            printer.println('Besteld door: ' + waiter.displayName)
            printer.drawLine()

            for (const line in products[location]) {
              // Skip line if value (number of products) is 0
              const entry = products[location][line]
              if(entry.value === 0) continue

              const total = (entry.price * entry.value).toFixed(1);
              totalPrice += entry.price * entry.value
              totalNumber += entry.value
              printer.tableCustom([
                { text: entry.value, align: 'LEFT', width: 0.1 },
                { text: entry.name, align: 'LEFT', width: 0.4 },
                { text: entry.price, align: 'RIGHT', width: 0.2 },
                { text: total, align: 'RIGHT', width: 0.2 }
              ])
            }

            printer.drawLine()
            printer.tableCustom([
              { text: totalNumber, align: 'LEFT', width: 0.1 },
              { text: 'Totaal', align: 'LEFT', width: 0.6 },
              { text: totalPrice.toFixed(1), align: 'RIGHT', width: 0.2 }
            ])
            printer.newLine()
            printer.drawLine()
            printer.drawLine()

            printer.cut()
            printer.execute()
          });
        })
    }

  })


}

// This checks the queue for the printer, if something changes and has printerstatus 0, change the printStatus and send to the printer
db.collection('orders')
  .where('printStatus', '==', 0)
  .onSnapshot(querySnapshot => {
    querySnapshot.docChanges().forEach(change => {
      if (change.type === 'added') {
        // Set printer status to 1 (printing
        updatePrintStatus(change.doc.ref.path, 1)
        checkFirebaseQueue(change.doc.ref.path, change.doc.data())
      }
      if (change.type === 'modified') {
        console.log('ORDER MODIFIED')
      }
      if (change.type === 'removed') {
        console.log('ORDER REMOVED')
      }
    })
  })


