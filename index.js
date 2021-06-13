const ParserStream = require('htmlparser2/lib/WritableStream').WritableStream
const http = require('http')
const https = require('https')
const runParallelLimit = require('run-parallel-limit')
const { URL } = require('url')

module.exports = (pageURL, callback) => {
  let pageParsed
  try {
    pageParsed = new URL(pageURL)
  } catch (error) {
    return callback(error)
  }
  getAndParsePage(pageParsed, {
    hrefs: true, ids: true
  }, (error, { hrefs, ids, base }) => {
    if (error) return callback(error)

    // Check HREFs.
    const broken = []
    runParallelLimit(hrefs.map(href => done => {
      function finish (error) {
        setTimeout(() => done(error), 500)
      }

      let url
      try {
        // Apply any base HREF.
        url = new URL(href, base)
      } catch (error) {
        return finish()
      }

      // Only check HTTP and HTTPS links.
      const protocol = url.protocol
      let clientAPI
      if (protocol === 'http:') {
        clientAPI = http
      } else if (protocol === 'https:') {
        clientAPI = https
      } else {
        return finish()
      }

      // Short-circuit links to the same page.
      if (
        url.hostname === pageParsed.hostname &&
        url.pathname === pageParsed.pathname
      ) {
        const hash = url.hash
        if (!hash) return done()
        if (!ids.includes(hash.slice(1))) {
          broken.push(url)
          return finish()
        }
      }

      if (url.hash) {
        return getAndParsePage(url, { ids: true }, (error, { ids }) => {
          if (error) return broken.push(url)
          if (!ids.includes(url.hash)) broken.push(url)
        })
      }

      // Send HEAD request.
      clientAPI.request(url, {
        method: 'HEAD'
      }, response => {
        const statusCode = response.statusCode
        if (
          statusCode !== 200 &&
          (statusCode <= 300 || statusCode > 400) &&
          statusCode !== 401 &&
          statusCode !== 403
        ) {
          broken.push(url)
        }
        finish()
      })
        .once('error', error => finish(error))
        .end()
    }), 3, error => {
      if (error) return callback(error)
      callback(null, broken)
    })
  })
}

function getAndParsePage (url, { hrefs: returnHREFs, ids: returnIDs }, callback, depth = 0) {
  if (depth > 3) {
    const error = new Error(`${url}: too many redirects`)
    return callback(error, {})
  }

  https.get(url, (response) => {
    // Check the response status code.
    const statusCode = response.statusCode
    if (statusCode === 301 || statusCode === 302 || statusCode === 303) {
      const location = response.headers.location
      if (!location) {
        const error = new Error(`${url} redirected without Location header`)
        return callback(error, {})
      }
      let parsed
      try {
        parsed = new URL(location, url)
      } catch (error) {
        return callback(error, {})
      }
      return getAndParsePage(parsed, { hrefs: returnHREFs, ids: returnIDs }, callback, depth + 1)
    }
    if (statusCode !== 200) {
      const error = new Error(`${url} responded ${statusCode}`)
      error.statusCode = statusCode
      return callback(error, {})
    }

    // Find HREFs to check.
    const hrefs = []
    // Find IDs.
    const ids = []
    // Note any base HREF for later.
    let base = url
    const parser = new ParserStream({
      onopentag (name, { id, href }) {
        // <base href="">
        if (name === 'base' && href) {
          base = href
          return
        }
        // <a href="">
        if (returnHREFs && name === 'a' && href) hrefs.push(href)
        if (returnIDs && id) ids.push(id)
      }
    })

    // Parse the HTML response body.
    response.pipe(parser).once('finish', () => {
      callback(null, { hrefs, ids, base })
    })
  })
}
