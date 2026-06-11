const systemCapacityService = require("../../Services/systemCapacityService");

class SystemCapacityController {
  browserCapacity(req, res) {
    res.json(systemCapacityService.browserCapacity());
  }
}

module.exports = new SystemCapacityController();
