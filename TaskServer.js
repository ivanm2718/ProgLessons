// Import module 'pg' for working with PostgreSQL
const { Pool } = require('pg');
const express = require('express');
var cors = require('cors')

const app = express();
const port = 3000; //app access port, not to be confused with db port

app.use(express.json());
app.use(cors());

// config connection with database
const pool = new Pool({
  user: 'postgres',    // username for database
  host: 'localhost',   // local server
  database: 'taskmanager_db',// name of database you created
  password: "1234", // pass
  port: 5432,          // standard port for PostgreSQL
});

// test connection
pool.query('SELECT NOW()', (err, res) => {
  if (err) console.error(err);
  else console.log('Connected to PostgreSQL', res.rows[0].now);
});

// set up server to listen 
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});


// GET /tasks/?user_id=1
app.get('/tasks', async (req, res) => {
  try {
      let query = 'SELECT * FROM tasks';
      let completed = req.query.completed;
      let params = []

      if(completed) {
        query += ` WHERE completed=$1`
        params.push(completed)
      }

      // Execute the query
      const { rows } = await pool.query(query,params);
      res.json(rows);
  } catch (err) {
      console.error('Error fetching tasks:', err);
      res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

  // POST - Create a new task (POST /tasks)
app.post('/tasks', async (req, res) => {
    const { name, completed, user_id } = req.body;
    try {
      const { rows } = await pool.query(
        'INSERT INTO tasks (name, completed, user_id) VALUES ($1, $2, $3) RETURNING *',
        [name, completed, user_id]
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: 'Failed to create task' });
    }
});


// PUT - update a task (PUT /tasks/:id)
app.put('/tasks/:id', async (req, res) => {
  const { id } = req.params;
  const { name, completed, user_id } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE tasks SET name = $1, completed = $2, user_id = $3 WHERE id = $4 RETURNING *',
      [name, completed, user_id, id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// DELETE a task by ID (DELETE /tasks/:id)
app.delete('/tasks/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query('DELETE FROM tasks WHERE id = $1 RETURNING *', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.status(204).send(); // 204 = No Content
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete task' });
  }
});




