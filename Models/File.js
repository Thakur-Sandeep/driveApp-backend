const mongoose = require('mongoose');

const FileSchema = new mongoose.Schema({
  name: { type: String, required: true },
  size: { type: Number, default: 0 },
  type: { type: String, required: true }, 
  url: String,         
  storagePath: String,  
  userId: { type: String, required: true },
  folderId: { type: String, default: 'root' }, 
  isFolder: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  isTrashed: { type: Boolean, default: false },
  trashedAt: { type: Date, default: null },
  isStarred: { type: Boolean, default: false },
  ownerEmail: { type: String, required: true },
  sharedWith: [{
    email: { type: String, lowercase: true },
    role: { type: String, enum: ['viewer', 'editor'], default: 'viewer' }
  }],
},{ timestamps: true });

module.exports = mongoose.model('File', FileSchema);