#!/usr/bin/env node
const url = process.argv[2]

require('./')(url, (error, results) => {
  if (error) {
    console.error(error)
    process.exit(1)
  }
  if (results.length === 0) process.exit(0)
  results.forEach(result => {
    console.log(`${url}\t${result}`)
  })
  process.exit(1)
})
