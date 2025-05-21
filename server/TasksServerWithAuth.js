// Import necessary modules
const { Pool } = require('pg');        // For PostgreSQL interaction
const express = require('express');    // Web framework
const cors = require('cors');          // To allow frontend requests
const bcrypt = require('bcrypt');      // For hashing passwords
const jwt = require('jsonwebtoken');   // For creating/verifying JWTs

const app = express();
const port = 3000; // Server port

// --- Configuration ---
// Use environment variables in a real app! This is simplified.
const JWT_SECRET = "SECRET_KEY"; // CHANGE THIS! Keep it secret!
const SALT_ROUNDS = 10; // How much processing power to use for hashing (higher = slower but more secure)

// --- Database Connection ---
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'taskmanager_db',
  password: "1234", 
  port: 5432,
});

// Test DB connection
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
      console.error("Database Connection Error:", err);
  } else {
      console.log('Connected to PostgreSQL at', res.rows[0].now);
  }
});

// --- Middleware Setup ---
app.use(cors());          // Allow requests from other origins (like your Vue frontend)
app.use(express.json());  // Allow server to understand JSON request bodies

// Authentication Middleware - This function checks if a valid JWT was sent with the request
const authenticateToken = (req, res, next) => {
  // Get the token from the Authorization header (e.g., "Bearer TOKEN_STRING")
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Extract the token part

  if (token == null) {
    // No token was sent
    return res.status(401).json({ error: 'Authentication token required' }); // 401 Unauthorized
  }

  // Verify the token using the secret key
  jwt.verify(token, JWT_SECRET, (err, userPayload) => {
    if (err) {
      // Token is invalid (expired, wrong signature, etc.)
      return res.status(403).json({ error: 'Invalid or expired token' }); // 403 Forbidden
    }

    // Token is valid! Attach the payload (user info) to the request object
    // Now other route handlers know who the logged-in user is
    req.user = userPayload; // Contains whatever we put in it during login (e.g., { userId: ..., username: ...})
    next(); // Allow the request to proceed to the intended route handler
  });
};


// --- Routes ---

// == Authentication Routes ==

// POST /register - Create a new user account
app.post('/register', async (req, res) => {
  const { username, password, is_admin = false } = req.body; // by default is_admin is set to false

  // Basic validation
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    // Check if username already exists
    const userCheck = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (userCheck.rows.length > 0) {
        return res.status(409).json({ error: 'Username already taken' }); // 409 Conflict
    }

    // Hash the password using bcrypt (includes salting automatically)
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Insert the new user into the database
    const { rows } = await pool.query(
      'INSERT INTO users (username, password, is_admin) VALUES ($1, $2, $3) RETURNING id, username, is_admin', // Don't return the password hash!
      [username, passwordHash, is_admin]
    );

    res.status(201).json({ // 201 Created
        message: 'User registered successfully!',
        user: rows[0] // Send back some user info (excluding password hash)
    });

  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Failed to register user' });
  }
});

// POST /login - Log a user in
app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    // Find the user by username
    const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);

    if (rows.length === 0) {
      // User not found
      return res.status(401).json({ error: 'Invalid username or password' }); // Use a generic message for security
    }

    const user = rows[0];

    // Compare the provided password with the stored hash using bcrypt
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      // Passwords don't match
      return res.status(401).json({ error: 'Invalid username or password' }); // Generic message
    }

    // --- Password is Correct - Authentication Successful! ---

    // Create a JWT payload (information to store in the token)
    // Keep payload small! Don't store sensitive info here.
    const jwtPayload = {
      userId: user.id,        // Include user ID
      username: user.username, // Include username
      is_admin: user.is_admin // Include role (admin/normal user)
    };

    // Sign the JWT using the secret key. It will expire in 1 hour.
    const token = jwt.sign(jwtPayload, JWT_SECRET, { expiresIn: '5d' }); // '1h' = 1 hour, '7d' = 7 days etc.

    // Send the token back to the client
    res.json({
        message: 'Login successful!',
        token: token // The client needs to store this token
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Failed to log in' });
  }
});


// GET /tasks - Fetch tasks. Admins see all, regular users see only their own.
// Apply the authenticateToken middleware *before* the route handler
app.get('/tasks', authenticateToken, async (req, res) => {
    // The user ID and is_admin status are now available from the token payload
    const loggedInUserId = req.user.userId;
    // Make sure 'is_admin' matches the key you put in the JWT payload during login
    const is_admin = req.user.is_admin;
  
  
    try {
        let query;
        let params;
  
        // Check if the user is an admin (based on the JWT payload)
        if (is_admin === true) { // Explicitly check for true
            // Admins get all tasks, regardless of user_id
            query = 'SELECT * FROM tasks'; // Order by user then task id
            params = []; // No parameters needed for this query
        } else {
            // Regular users only get tasks matching their user_id
            query = 'SELECT * FROM tasks WHERE user_id = $1';
            params = [loggedInUserId]; // Pass the user's ID as a parameter
        }
  
        // Execute the dynamically constructed query
        const { rows } = await pool.query(query, params);
        res.json(rows); // Send back the appropriate set of tasks
  
    } catch (err) {
        console.error('Error fetching tasks:', err);
        res.status(500).json({ error: 'Failed to fetch tasks' });
    }
  });
  
    // POST - Create a new task (POST /tasks) - authenticate first, only logged in users can create tasks for themselves
  app.post('/tasks', authenticateToken, async (req, res) => {
      const { name, completed } = req.body;
      let user_id = req.user.userId;

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

// PUT /tasks/:id - Update a task. Admins can update any task, users only their own.
//                  Crucially, USER_ID of the task IS NOT CHANGED.
app.put('/tasks/:id', authenticateToken, async (req, res) => {
  const { id } = req.params; // Task ID from URL parameter
  const { name, completed } = req.body; // Updated data from request body
  const loggedInUserId = req.user.userId; // User ID from authenticated token
  const isAdmin = req.user.is_admin;     // Admin status from authenticated token

  // Basic validation for incoming data
  if (name === undefined || completed === undefined) {
    return res.status(400).json({ error: 'Task name and completed status are required for update' });
  }

  try {
    let query;
    let params;

    // --- Conditional Logic Based on Admin Status ---
    if (isAdmin === true) {
        // ADMIN: Can update any task based on task ID only.
        //        DO NOT update the user_id column!
        query = `
            UPDATE tasks
            SET name = $1, completed = $2
            WHERE id = $3
            RETURNING *
        `;
        params = [name, completed, id]; // Parameters match $1, $2, $3 in query
    } else {
        // REGULAR USER: Can only update task if ID matches AND user_id matches their own.
        //                DO NOT update the user_id column!
        query = `
            UPDATE tasks
            SET name = $1, completed = $2
            WHERE id = $3 AND user_id = $4
            RETURNING *
        `;
        params = [name, completed, id, loggedInUserId]; // Parameters match $1, $2, $3, $4
    }

    // Execute the appropriate query
    const { rows } = await pool.query(query, params);

    // Check if any row was updated
    if (rows.length === 0) {
      // If no rows returned, either task doesn't exist OR non-admin doesn't own it.
      // We can check if the task exists at all for a better error message.
      const taskCheck = await pool.query('SELECT id FROM tasks WHERE id = $1', [id]);
       if (taskCheck.rows.length === 0) {
           // Task definitely doesn't exist
           return res.status(404).json({ error: 'Task not found' });
       } else {
            // Task exists, but the user didn't have permission (must be non-admin case)
           return res.status(403).json({ error: 'Forbidden: You do not own this task or lack permissions' });
       }
    }

    // If successful, return the updated task data (with original user_id)
    res.json(rows[0]);

  } catch (err) {
    console.error('BACKEND Update task error:', err);
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

  
  // DELETE a user by ID (DELETE /users/:id)
  app.delete('/users/:id', async (req, res) => {
    const { id } = req.params;
    try {
      const { rows } = await pool.query('DELETE FROM users WHERE id = $1 RETURNING *', [id]);
      if (rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      res.status(204).send(); // 204 = No Content
    } catch (err) {
      res.status(500).json({ error: 'Failed to delete user' });
    }
  });
  
  
  

// == Server Startup ==
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});