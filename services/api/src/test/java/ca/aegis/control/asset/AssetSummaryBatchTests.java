package ca.aegis.control.asset;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;

import ca.aegis.control.reservation.ReservationFixtures;
import ca.aegis.control.support.ApiIntegrationTest;

class AssetSummaryBatchTests extends ApiIntegrationTest {
    @Autowired JdbcClient jdbc;
    @Autowired AssetCustodyRepository custody;
    @Autowired PhysicalPresence presence;

    @Test
    void summariesUseOneSelectForDistinctAssetsKeepArchivedAssetsAndSkipEmptyCollections() {
        var fixtures = new ReservationFixtures(jdbc);
        UUID locker = fixtures.locker();
        UUID first = fixtures.assetAt(locker, 1);
        UUID archived = fixtures.assetAt(locker, 2);
        jdbc.sql("UPDATE aegis.assets SET archived_at=:at WHERE id=:id")
                .param("id", archived).param("at", START.atOffset(ZoneOffset.UTC)).update();
        var statements = new AtomicInteger();
        JdbcClient measured = (JdbcClient) Proxy.newProxyInstance(JdbcClient.class.getClassLoader(),
                new Class<?>[]{JdbcClient.class}, (proxy, method, args) -> {
                    if (method.getName().equals("sql")) statements.incrementAndGet();
                    try { return method.invoke(jdbc, args); }
                    catch (InvocationTargetException failure) { throw failure.getCause(); }
                });
        var assets = new ReservableAssets(new AssetRepository(measured), custody, presence);
        var summaries = assets.summaries(List.of(first, archived, first));
        assertEquals(1, statements.get());
        assertEquals(2, summaries.size());
        assertEquals(first, summaries.get(first).id());
        assertEquals(archived, summaries.get(archived).id());
        assertEquals(locker, summaries.get(archived).placement().lockerId());
        assertTrue(assets.summaries(List.of()).isEmpty());
        assertEquals(1, statements.get());
    }
}
