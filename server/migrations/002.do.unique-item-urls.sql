-- Only links have an address; NULLs never conflict, so text and screenshots are unaffected.
CREATE UNIQUE INDEX items_url ON items (url);
