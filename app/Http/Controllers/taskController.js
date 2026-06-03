const taskService = require("../../Services/taskService");

class TaskController {
  async index(req, res) {
    const tasks = await taskService.listTasks();
    res.json(tasks);
  }

  async show(req, res) {
    const task = await taskService.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: "Task not found" });
    res.json(task);
  }

  async store(req, res) {
    const task = await taskService.createTask(req.body);
    res.status(201).json(task);
  }

  async destroy(req, res) {
    const task = await taskService.cancelTask(req.params.id);
    if (!task) return res.status(404).json({ error: "Task not found" });
    res.json(task);
  }
}

module.exports = new TaskController();
