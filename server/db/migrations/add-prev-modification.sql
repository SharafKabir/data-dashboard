-- Migration: Add prev_modification column to dataset table
-- Run this if the column doesn't exist yet

ALTER TABLE dataset 
ADD COLUMN IF NOT EXISTS prev_modification VARCHAR(255) DEFAULT NULL;

