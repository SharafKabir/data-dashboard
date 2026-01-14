-- postgres schema
-- tables: users, dataset, modifications, names

-- users table
CREATE TABLE IF NOT EXISTS users (
    cognito_sub VARCHAR(255) PRIMARY KEY,
    email VARCHAR(255) NOT NULL
);

-- dataset table
CREATE TABLE IF NOT EXISTS dataset (
    ds_group_id UUID NOT NULL DEFAULT gen_random_uuid(),
    commit_id UUID NOT NULL DEFAULT gen_random_uuid(),
    cognito_sub VARCHAR(255) NOT NULL,
    parent_commit_id UUID,
    parent_ds_group_id UUID,
    PRIMARY KEY (ds_group_id, commit_id),
    UNIQUE (commit_id), -- commit_id needs to be unique for foreign keys
    FOREIGN KEY (cognito_sub) REFERENCES users(cognito_sub),
    FOREIGN KEY (parent_ds_group_id, parent_commit_id) REFERENCES dataset(ds_group_id, commit_id)
);

-- modifications table
CREATE TABLE IF NOT EXISTS modifications (
    commit_id UUID NOT NULL,
    parent_commit_id UUID NOT NULL,
    order_num INTEGER NOT NULL,
    description VARCHAR(255) NOT NULL,
    PRIMARY KEY (commit_id, parent_commit_id, order_num),
    FOREIGN KEY (commit_id) REFERENCES dataset(commit_id),
    FOREIGN KEY (parent_commit_id) REFERENCES dataset(commit_id)
);

-- names table
CREATE TABLE IF NOT EXISTS names (
    name VARCHAR(255) NOT NULL,
    ds_group_id UUID NOT NULL,
    cognito_sub VARCHAR(255) NOT NULL,
    root_commit_id UUID NOT NULL,
    PRIMARY KEY (ds_group_id, root_commit_id),
    FOREIGN KEY (ds_group_id, root_commit_id) REFERENCES dataset(ds_group_id, commit_id),
    CONSTRAINT names_cognito_sub_name_unique UNIQUE (cognito_sub, name)
);

