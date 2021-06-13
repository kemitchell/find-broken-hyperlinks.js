const ParserStream = require('htmlparser2/lib/WritableStream').WritableStream
const http = require('http')
const https = require('https')
const runParallelLimit = require('run-parallel-limit')
const { URL } = require('url')

module.exports = (pageURL, callback) => {
  // Fetch the contents of the page.
  let pageParsed
  try {
    pageParsed = new URL(pageURL)
  } catch (error) {
    return callback(error)
  }
  https.get(pageParsed, (response) => {
    // Check the response status code.
    const statusCode = response.statusCode
    if (statusCode !== 200) {
      const error = new Error(`${pageURL} responded ${statusCode}`)
      error.statusCode = statusCode
      return callback(error)
    }

    // Find HREFs to check.
    const toCheck = []
    // Note any base HREF for later.
    let base = pageURL
    const parser = new ParserStream({
      onopentag (name, { href }) {
        // <base href="">
        if (name === 'base' && href) {
          base = href
          return
        }
        // <a href="">
        if (name === 'a' && href) toCheck.push(href)
      }
    })

    // Parse the HTML response body.
    response.pipe(parser).once('finish', () => {
      // Check HREFs.
      const broken = []
      runParallelLimit(toCheck.map(href => done => {
        // Apply any base HREF.
        let url
        try {
          url = new URL(href, base)
        } catch (error) {
          return done()
        }

        // Only check HTTP and HTTPS links.
        const protocol = url.protocol
        let clientAPI
        if (protocol !== 'http:') {
          clientAPI = http
        } else if (protocol !== 'https:') {
          clientAPI = https
        } else {
          return done()
        }

        // Send HEAD request.
        clientAPI.request(url, {
          method: 'HEAD'
        }, response => {
          if (response.statusCode !== 200) {
            broken.push(url)
          }
          done()
        })
          .once('error', error => done(error))
          .end()
      }), 3, error => {
        if (error) return callback(error)
        callback(null, broken)
      })
    })
  })
    .once('error', error => callback(error))
}
