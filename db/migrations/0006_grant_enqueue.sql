-- create_batch (invoker) calls enqueue_batch; the definer function checks the caller owns the batch.
grant execute on function atlas.enqueue_batch(uuid) to atlas_user;
