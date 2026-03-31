const express = require('express');
const router = express.Router();
const File = require('../Models/File');
const { supabase } = require('../lib/supabase');

// 1. Save metadata
router.post('/save-metadata', async (req, res) => {
  try {
    const newFile = new File(req.body);
    await newFile.save();
    res.status(201).json(newFile);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get Starred Files
router.get('/starred/:userId', async (req, res) => {
  try {
    const files = await File.find({ 
      userId: req.params.userId, 
      isStarred: true,
      isTrashed: false 
    }).sort({ createdAt: -1 });
    res.json(files);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET Trash
router.get('/trash/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { userEmail } = req.query; 

    const query = {
      isTrashed: true,
      $or: [
        { userId: userId },
        { "sharedWith.email": userEmail?.toLowerCase() } 
      ]
    };

    const files = await File.find(query).sort({ trashedAt: -1 });
    res.json(files);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET files shared with a specific email
router.get('/shared-with-me/:email', async (req, res) => {
  try {
    const files = await File.find({ 
      "sharedWith.email": req.params.email.toLowerCase(),
      isTrashed: false 
    }).sort({ createdAt: -1 });
    res.json(files);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Empty Trash
router.delete('/empty/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const trashedItems = await File.find({ userId, isTrashed: true });
    if (trashedItems.length === 0) return res.json({ message: "Trash is already empty" });

    const storagePaths = trashedItems
      .filter(item => !item.isFolder && item.storagePath)
      .map(item => item.storagePath);
    const itemIds = trashedItems.map(item => item._id);

    if (storagePaths.length > 0) {
      await supabase.storage.from('drive-files').remove(storagePaths);
    }
    await File.deleteMany({ _id: { $in: itemIds } });
    res.json({ message: "Trash emptied successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PERMANENT DELETE
router.delete('/permanent/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.query;

    const item = await File.findById(id);
    if (!item) return res.status(404).json({ message: "Item not found" });

    if (item.userId !== userId) {
      return res.status(403).json({ message: "Only the owner can permanently delete items" });
    }

    if (!item.isFolder && item.storagePath) {
      await supabase.storage.from('drive-files').remove([item.storagePath]);
    }

    if (item.isFolder) {
      await File.deleteMany({ folderId: id }); 
    }

    await File.findByIdAndDelete(id);
    res.json({ message: "Item permanently deleted" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// SHARE WITH ROLE (Viewer/Editor)
router.patch('/share-with-role/:id', async (req, res) => {
  try {
    const { targetEmail, role } = req.body;
    const email = targetEmail.toLowerCase();
    const fileId = req.params.id;

    const shareRecursive = async (id) => {
      const item = await File.findById(id);
      if (!item) return;
      const existingUserIndex = item.sharedWith.findIndex(s => s.email === email);
      if (existingUserIndex > -1) {
        item.sharedWith[existingUserIndex].role = role;
      } else {
        item.sharedWith.push({ email, role });
      }
      await item.save();
      if (item.isFolder) {
        const children = await File.find({ folderId: id });
        for (const child of children) {
          await shareRecursive(child._id);
        }
      }
    };

    await shareRecursive(fileId);
    const updatedFile = await File.findById(fileId);
    res.json(updatedFile);

  } catch (error) {
    console.error("Recursive Sharing Error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.patch('/leave-shared/:id', async (req, res) => {
  try {
    const { userEmail } = req.body;
    const email = userEmail?.toLowerCase();

    if (!email) return res.status(400).json({ message: "User email is required" });

    const file = await File.findById(req.params.id);
    if (!file) return res.status(404).json({ message: "File not found" });

    file.sharedWith = file.sharedWith.filter(s => s.email !== email);
    await file.save();

    if (file.isFolder) {
      await File.updateMany(
        { folderId: file._id.toString() },
        { $pull: { sharedWith: { email: email } } }
      );
    }

    res.json({ message: "Left shared item successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Toggle Star
router.patch('/star/:id', async (req, res) => {
  try {
    const file = await File.findById(req.params.id);
    file.isStarred = !file.isStarred;
    await file.save();
    res.json(file);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Move File
router.patch('/move', async (req, res) => {
  try {
    const { fileId, targetFolderId } = req.body;
    if (!fileId || !targetFolderId) return res.status(400).json({ message: "Missing data" });
    const updatedFile = await File.findByIdAndUpdate(fileId, { folderId: targetFolderId }, { new: true });
    res.json(updatedFile);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Restore
router.patch('/restore/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { userEmail, userId } = req.body;

    const item = await File.findById(id);
    if (!item) return res.status(404).json({ message: "Item not found" });

    const isOwner = item.userId === userId;
    const isEditor = item.sharedWith?.some(s => 
      s.email === userEmail?.toLowerCase() && s.role === 'editor'
    );

    if (!isOwner && !isEditor) {
      return res.status(403).json({ message: "No permission to restore" });
    }

    await File.findByIdAndUpdate(id, { isTrashed: false, trashedAt: null });
    if (item.isFolder) {
      await File.updateMany({ folderId: id.toString() }, { isTrashed: false, trashedAt: null });
    }
    res.json({ message: "Restored successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});



router.patch('/rename/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { newName, userEmail, userId } = req.body;

    const file = await File.findById(id);
    if (!file) return res.status(404).json({ message: "File not found" });

    const isOwner = file.userId === userId;
    
    const isEditor = Array.isArray(file.sharedWith) && file.sharedWith.some(s => 
      s?.email === userEmail?.toLowerCase() && s?.role === 'editor'
    );

    if (!isOwner && !isEditor) {
      return res.status(403).json({ message: "Forbidden: No edit permissions" });
    }

    file.name = newName;
    await file.save();
    res.json(file);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Metadata
router.get('/metadata/:id', async (req, res) => {
  try {
    const path = [];
    let current = await File.findById(req.params.id);
    if (!current) return res.status(404).json({ message: "Not found" });
    let tempItem = current;
    while (tempItem) {
      path.unshift({ id: tempItem._id.toString(), name: tempItem.name });
      if (!tempItem.folderId || tempItem.folderId === 'root') break;
      tempItem = await File.findById(tempItem.folderId);
      if (!tempItem) break;
    }
    res.json({ name: current.name, path: path });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get User Drive
router.get('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { folderId } = req.query; 
    const files = await File.find({ 
      userId, 
      folderId: folderId || 'root',
      isTrashed: false 
    }).sort({ isFolder: -1, type: 1, createdAt: -1 });
    res.json(files);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// SOFT DELETE
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { userEmail, userId } = req.query; 

    const item = await File.findById(id);
    if (!item) return res.status(404).json({ message: "Item not found" });

    //Permission Check
    const isOwner = item.userId === userId;
    const isEditor = item.sharedWith?.some(s => 
      s.email === userEmail?.toLowerCase() && s.role === 'editor'
    );

    if (!isOwner && !isEditor) {
      return res.status(403).json({ message: "Forbidden: No permission to trash this item" });
    }

    const now = new Date();
    await File.findByIdAndUpdate(id, { isTrashed: true, trashedAt: now });
    
    if (item.isFolder) {
      await File.updateMany({ folderId: id.toString() }, { isTrashed: true, trashedAt: now });
    }

    res.json({ message: "Moved to Trash" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


module.exports = router;