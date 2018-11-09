const platformIt = (name, platforms, fn) => {
  let testFn = it
  if (!platforms.includes(process.platform)) {
    testFn = it.skip
  }

  return testFn(name, fn)
}

module.exports = {
  platformIt
}
